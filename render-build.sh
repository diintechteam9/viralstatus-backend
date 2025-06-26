#!/usr/bin/env bash
# exit on error
set -o errexit

# Install dependencies
npm install

# Install ffmpeg
apt-get update && apt-get install -y ffmpeg 