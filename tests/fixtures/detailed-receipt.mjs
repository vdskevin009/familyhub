export const receiptDossier={expenseId:'synthetic-receipt',insurer:'blue-cross',blocked:false,reviewableWarnings:[],portalUrl:'https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/eClaim.aspx',fields:{patient:'Sample',provider:'Synthetic Clinic',practitioner:'Dr. Sample Practitioner',invoiceNumber:'SYN-001',serviceDate:'2026-10-13',originalAmount:80},attachments:[{documentId:'synthetic-receipt',attachmentId:'pdf',name:'synthetic.pdf'}]};
export const receiptText=`Synthetic Clinic
#100 - 123 Sample St., Example City, BC, V1A 2B3
Tel: 555-0100
Sample Patient
Receipt
Items and Payments
Items Details Amount
October 13, 2026 - 2:00pm, Synthetic service
Dr. Sample Practitioner, License #TEST123
Invoice #SYN-001 $80.00
Subtotal $80.00
Payer Total $80.00
Payments
Tuesday October 13, 2026 - 2:17pm Credit Card Sample Patient
$80.00
Date and Time: October 13, 2026 - 2:17pm
Status: authorized succeeded
Amount: $80.00`;
// Minimal valid, one-page synthetic PDF; no external library or real receipt.
export function receiptPdf(text){
 const stream='BT /F1 10 Tf 40 770 Td 14 TL\n'+text.split('\n').map(line=>'('+line.replace(/[\\()]/g,'\\$&')+') Tj T*').join('\n')+'\nET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(pdf);
}
