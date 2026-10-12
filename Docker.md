# Download image
docker pull zaproxy/zap-stable

# Run ZAP
docker run -d --name owasp-zap -p 8080:8080 owasp/zap2docker-stable zap.sh -daemon -host 0.0.0.0 -port 8080 -config api.disablekey=true -config api.addrs.addr.name=.* -config api.addrs.addr.regex=true

# List running containers
docker ps

# Stop
docker stop owasp-zap

# Start again
docker start owasp-zap

# Logs
docker logs owasp-zap

# Remove
docker rm -f owasp-zap