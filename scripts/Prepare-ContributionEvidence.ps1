param([Parameter(Mandatory)][string]$DataDirectory,[Parameter(Mandatory)][string]$CsvName,[Parameter(Mandatory)][long]$GoalCents,[Parameter(Mandatory)][string]$PlanThrough,[Parameter(ValueFromPipeline=$true,Mandatory)][string]$MappingJson,[ValidateSet('rrsp','resp')][string]$PlanKind='rrsp')
$ErrorActionPreference='Stop'
$meta=($MappingJson|ConvertFrom-Json)
$ledger=Get-Content -LiteralPath (Join-Path $DataDirectory 'finances/ledger.json') -Raw|ConvertFrom-Json
$csv=Join-Path $DataDirectory ('contribution-sync/intake/'+$CsvName)
$rows=if($meta.transactions){@($meta.transactions)}else{@(Import-Csv -LiteralPath $csv)}
if($rows.Count-ne $meta.selection.rowCount){throw 'Source count differs'}
$accountMap=@{};$destination=$null;$sourceIds=@()
foreach($a in $meta.accounts){
 $matches=@($ledger.data.accounts|Where-Object{$_.id-match ('(?i)(?:^|[^a-z0-9])'+[regex]::Escape($a.mask)+'$')-and $_.currency-eq 'CAD'})
 if($matches.Count-ne 1){throw 'Account mapping is not unique'}
 if(($a.role-eq 'destination'-and $matches[0].type-ne 'brokerage')-or($a.role-eq 'source'-and $matches[0].type-ne 'bank')){throw 'Account type mismatch'}
 $accountMap[$a.account_id]=$matches[0].id
 if($a.role-eq 'destination'){$destination=$a}else{$sourceIds+=$matches[0].id}
}
$normalized=@();$resolutions=@{};$adapterAccounts=@{};$excluded=@();$verifiedIds=@();$existing=0;$fresh=0
function Digest([object]$value){$json=ConvertTo-Json -InputObject $value -Compress -Depth 15;return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($json))).ToLowerInvariant()}
foreach($r in $rows){
 if(!$accountMap.ContainsKey($r.account_id)){throw 'Unmapped source account'}
 $amount=[decimal]::Parse([string]$r.amount,[Globalization.CultureInfo]::InvariantCulture)
 if(($amount*100)-ne [decimal]::Round($amount*100)){throw 'Fractional cents'}
 $isPending=if($r.pending -is [bool]){$r.pending}elseif($r.pending-eq 'False'){$false}elseif($r.pending-eq 'True'){$true}else{throw 'Unknown pending state'}
 $key=Digest @('finances',$r.item_id,$r.account_id,$r.transaction_id)
 $ak=ConvertTo-Json -InputObject @($r.item_id,$r.account_id) -Compress
 $adapterAccounts[$ak]=$accountMap[$r.account_id]
 $row=[ordered]@{};foreach($property in $r.PSObject.Properties){$row[$property.Name]=$property.Value};$row.amount=$amount;$row.normalized_amount=[decimal]::Parse([string]$r.normalized_amount,[Globalization.CultureInfo]::InvariantCulture);$row.pending=$isPending
 $normalized+=$row
 if($r.transaction_id -cin $meta.classification.unattributedTransactionIds){$excluded+=$key;continue}
 if($r.transaction_id -cnotin $meta.classification.identifiedTransactionIds){throw 'Unclassified selection'}
 if($isPending){throw 'Identified selection contains pending transaction'}
 $candidates=@($ledger.data.transactions|Where-Object{$_.accountId-eq $accountMap[$r.account_id]-and $_.date-eq $r.date-and $_.outflowCents-eq ($amount*100)-and $_.currency-eq $r.iso_currency_code})
 if(!$candidates.Count){$resolutions[$key]=@{kind='new'};$verifiedIds+=('finances:'+$key);$fresh++;continue}
 $sourceNormalized=($r.merchant_name.Normalize() -replace '\s+',' ').Trim().ToUpperInvariant()
 $exact=@($candidates|Where-Object{(($_.description.Normalize() -replace '\s+',' ').Trim().ToUpperInvariant()) -eq $sourceNormalized})
 $qualified=if($exact.Count-eq 1){$exact}else{@($candidates|Where-Object{($r.name-match '\b(?:RRSP|RSP)\b'-and $_.description-match '\b(?:RRSP|RSP)\b')-or($r.merchant_name-like ('*TFR-TO*'+$destination.mask+'*')-and $_.description-like ('*TFR-TO*'+$destination.mask+'*'))})}
 if($qualified.Count-ne 1){throw 'Historical source identity requires review'}
 $resolutions[$key]=@{kind='existing';ledgerId=$qualified[0].id};$verifiedIds+=$qualified[0].id;$existing++
}
if(($existing+$fresh)-ne $meta.classification.identifiedTransactionIds.Count -or $excluded.Count-ne $meta.classification.unattributedTransactionIds.Count){throw 'Classification reconciliation failed'}
if(@($verifiedIds|Sort-Object -Unique).Count-ne $verifiedIds.Count){throw 'Duplicate ledger binding'}
$stamp=[regex]::Match($CsvName,'\d{8}T\d{6}Z').Value
$retrieved=if($meta.retrievedAt){$meta.retrievedAt}else{[datetime]::ParseExact($stamp,"yyyyMMdd'T'HHmmss'Z'",[Globalization.CultureInfo]::InvariantCulture).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")}
$prepared=[ordered]@{
 pages=@(@{requestCursor=$null;result=@{items=$normalized;has_more=$false;next_cursor=$null;coverage=$meta.coverage}})
 mapping=@{expectedRevision=$ledger.revision;from=$meta.selection.startDate;through=$meta.selection.endDate;retrievedAt=$retrieved;accounts=$adapterAccounts;resolutions=$resolutions;excludedTransactionKeys=$excluded}
 contributionPlan=@{from=$meta.selection.startDate;through=$PlanThrough;currency='CAD';targetAccountId=$accountMap[$destination.account_id];personalGoalCents=$GoalCents;debitAccounts=$sourceIds;exactTransferDescriptions=@();verifiedTransferTransactionIds=$verifiedIds}
 provenance=@{sourceLibraryRef=$meta.sourceLibraryRef;sourceCsvName=$CsvName;sourceCsvSha256=if(Test-Path -LiteralPath $csv){(Get-FileHash -LiteralPath $csv -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null};selection=$meta.selection;sourceAsOf=$null}
}
$path=Join-Path $DataDirectory ('contribution-sync/prepared-'+$PlanKind+'-evidence.json')
[IO.File]::WriteAllText($path,($prepared|ConvertTo-Json -Compress -Depth 30),[Text.UTF8Encoding]::new($false))
[pscustomobject]@{AccountMappings=$meta.accounts.Count;ExistingBindings=$existing;NewIdentities=$fresh;ExcludedUnassigned=$excluded.Count;LedgerWritten=$false}|ConvertTo-Json -Compress