@echo off
curl -v -N -H "Content-Type: application/json" -d @payload.json http://localhost:8787/api/chat > response.txt 2>&1
