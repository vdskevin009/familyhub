#!/usr/bin/env bash
set -euo pipefail
if ! command -v dotnet >/dev/null; then
 curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
 bash /tmp/dotnet-install.sh --version 11.0.100-rc.1.26425.128 --install-dir "$HOME/.dotnet"
fi
export PATH="$HOME/.dotnet:$PATH"
dotnet restore src/Web/Web.csproj
dotnet restore tests/Core.Tests/Core.Tests.csproj
