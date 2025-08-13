$ErrorActionPreference = 'Stop'

Write-Host 'Starting E2E API smoke test...'

$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$email = 'hack' + [guid]::NewGuid().ToString('N').Substring(0,8) + '@example.com'

# Signup and auth check
$signup = Invoke-RestMethod -WebSession $sess -Uri http://localhost:4001/auth/signup -Method Post -Body ("{`"name`":`"Hack User`",`"email`":`"$email`",`"password`":`"Password123!`"}") -ContentType 'application/json'
$me = Invoke-RestMethod -WebSession $sess -Uri http://localhost:4001/auth/me

# Create family and list
$family = Invoke-RestMethod -WebSession $sess -Uri http://localhost:4001/families -Method Post -Body '{"name":"QA Family"}' -ContentType 'application/json'
$list = Invoke-RestMethod -WebSession $sess -Uri http://localhost:4001/families
$fid = $family.family.id

# Initial tree
$tree0 = Invoke-RestMethod -WebSession $sess -Uri ("http://localhost:4001/families/$fid/tree")

# Create two people and move one
$n1 = Invoke-RestMethod -WebSession $sess -Uri ("http://localhost:4001/families/$fid/nodes") -Method Post -Body '{"name":"Alice"}' -ContentType 'application/json'
$n2 = Invoke-RestMethod -WebSession $sess -Uri ("http://localhost:4001/families/$fid/nodes") -Method Post -Body '{"name":"Bob"}' -ContentType 'application/json'
$p1 = Invoke-RestMethod -WebSession $sess -Uri ("http://localhost:4001/families/$fid/nodes/" + $n1.node.id + "/position") -Method Patch -Body '{"posX":120,"posY":60}' -ContentType 'application/json'

# Create a relationship
$edge = Invoke-RestMethod -WebSession $sess -Uri ("http://localhost:4001/families/$fid/edges") -Method Post -Body ('{"sourceId":"' + $n1.node.id + '","targetId":"' + $n2.node.id + '","type":"PARENT","label":"PARENT"}') -ContentType 'application/json'

# Final tree
$tree1 = Invoke-RestMethod -WebSession $sess -Uri ("http://localhost:4001/families/$fid/tree")

Write-Host ("EMAIL=$email")
Write-Host ("FAMILY=$fid")
Write-Host ("NODES_BEFORE=" + ($tree0.nodes.Count))
Write-Host ("NODES_AFTER=" + ($tree1.nodes.Count))
Write-Host ("EDGES_AFTER=" + ($tree1.edges.Count))
Write-Host ("NODE1_POS=" + ($tree1.nodes | Where-Object { $_.id -eq $n1.node.id } | Select-Object -First 1 | ForEach-Object { $_.position.x.ToString() + ',' + $_.position.y.ToString() }))
Write-Host ("EDGE_CREATED_ID=" + $edge.edge.id)

Write-Host 'E2E API smoke test complete.'
