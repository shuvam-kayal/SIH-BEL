param(
  [int]$ValidatorCount = 70,
  [int]$BaseP2pPort = 30303,
  [int]$BaseRpcPort = 8545
)

$ErrorActionPreference = 'Stop'
if ($ValidatorCount -lt 70) {
  throw 'BEL requires at least 70 active validators.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$besuRoot = Join-Path $repoRoot 'besu'
$besu = Join-Path $besuRoot 'build\install\besu\bin\besu-untuned.bat'
if (-not (Test-Path $besu)) {
  throw "Besu distribution not found. Run the local Gradle installDist task first. Expected: $besu"
}

$runtime = Join-Path $repoRoot '.bel-demo'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$runRoot = Join-Path $runtime $runId
$configRoot = Join-Path $runRoot 'config'
$generatedRoot = Join-Path $runRoot 'generated'
$nodesRoot = Join-Path $runRoot 'nodes'
New-Item -ItemType Directory -Force -Path $configRoot,$generatedRoot,$nodesRoot | Out-Null

$generatorConfig = [ordered]@{
  genesis = [ordered]@{
    config = [ordered]@{
      chainId = 20260919
      berlinBlock = 0
      qbft = [ordered]@{
        blockperiodseconds = 1
        epochlength = 30000
        requesttimeoutseconds = 2
      }
    }
    nonce = '0x0'
    timestamp = ('0x{0:x}' -f [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    gasLimit = '0x1fffffffffffff'
    difficulty = '0x1'
    mixHash = '0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365'
    coinbase = '0x0000000000000000000000000000000000000000'
  }
  blockchain = [ordered]@{
    nodes = [ordered]@{
      generate = $true
      count = $ValidatorCount
    }
  }
}

$configFile = Join-Path $configRoot 'network-config.json'
$json = $generatorConfig | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($configFile, $json, (New-Object System.Text.UTF8Encoding($false)))

& $besu operator generate-blockchain-config `
  --config-file=$configFile `
  --to=$generatedRoot `
  --genesis-file-name=genesis.json
if ($LASTEXITCODE -ne 0) {
  throw 'Besu failed to generate the BEL demo blockchain configuration.'
}

$genesis = Join-Path $generatedRoot 'genesis.json'
$keysRoot = Join-Path $generatedRoot 'keys'
$generatedNodes = Get-ChildItem -LiteralPath $keysRoot -Directory | Sort-Object Name
if ($generatedNodes.Count -ne $ValidatorCount) {
  throw "Expected $ValidatorCount generated validator directories, found $($generatedNodes.Count)."
}

$publicKeys = $generatedNodes | ForEach-Object {
  $publicKeyPath = Join-Path $_.FullName 'key.pub'
  if (-not (Test-Path $publicKeyPath)) {
    throw "Missing generated public key: $publicKeyPath"
  }
  ((Get-Content -LiteralPath $publicKeyPath -Raw).Trim() -replace '^0x', '')
}
# One bootnode is enough for local discovery and keeps the Windows command line
# well below its length limit. The bootnode then gossips the validator peers.
$bootnodeArgument = "enode://$($publicKeys[0])@127.0.0.1:$BaseP2pPort"

$processes = @()
for ($i = 0; $i -lt $generatedNodes.Count; $i++) {
  $generated = $generatedNodes[$i]
  $dataPath = Join-Path $nodesRoot ("node-{0:D3}" -f ($i + 1))
  $logPath = Join-Path $dataPath 'besu.log'
  $errorLogPath = Join-Path $dataPath 'besu-error.log'
  New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
  $arguments = @(
    '--genesis-file', $genesis,
    '--data-path', $dataPath,
    '--node-private-key-file', (Join-Path $generated.FullName 'key.priv'),
    '--p2p-host', '127.0.0.1',
    '--p2p-port', ($BaseP2pPort + $i),
    '--nat-method', 'NONE',
    '--bootnodes', $bootnodeArgument,
    '--rpc-http-enabled',
    '--rpc-http-host', '127.0.0.1',
    '--rpc-http-port', ($BaseRpcPort + $i),
    '--rpc-http-api', 'ETH,NET,WEB3,ADMIN',
    '--host-allowlist=*',
    '--min-gas-price', '0',
    '--logging', 'INFO'
  )
  $processes += Start-Process -FilePath $besu -ArgumentList $arguments -RedirectStandardOutput $logPath -RedirectStandardError $errorLogPath -WindowStyle Hidden -PassThru
}

[ordered]@{
  runRoot = $runRoot
  genesis = $genesis
  validatorCount = $ValidatorCount
  rpcPorts = (0..($ValidatorCount - 1) | ForEach-Object { $BaseRpcPort + $_ })
  processIds = $processes.Id
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runRoot 'run.json') -Encoding utf8

Write-Output "BEL demo started: $runRoot"
Write-Output "Validators: $ValidatorCount"
Write-Output "Genesis: $genesis"
Write-Output "Run metadata: $(Join-Path $runRoot 'run.json')"
