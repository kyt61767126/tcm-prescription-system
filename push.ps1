Write-Host "Push to Git Repository"
Write-Host "======================"
Write-Host ""

git add .
git commit -m "Update"
git push

Write-Host ""
Write-Host "Push completed"
Read-Host "Press Enter to exit"