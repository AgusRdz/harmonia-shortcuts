#!/bin/bash

if [ ! -d "node_modules" ]; then
     mkdir node_modules
fi

docker-compose build
docker-compose up -d
