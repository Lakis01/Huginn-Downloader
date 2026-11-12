$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "install.py"

if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 $scriptPath @args
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python $scriptPath @args
} else {
    throw "Python 3 was not found. Install Python 3, then retry install.ps1."
}

exit $LASTEXITCODE
