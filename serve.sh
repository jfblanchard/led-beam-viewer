#!/usr/bin/env bash
# Serve the LED Beam Viewer locally. The app always serves site/, so the
# bundled IES library (site/ies/) loads over http — file:// blocks fetch.
#
#   ./serve.sh          -> http://localhost:8471
#   ./serve.sh 9000     -> custom port
#
# Deployment note: exclude site/ies/vendor/ from any public build
# (manufacturer files are local-use only; see site/ies/LICENSES.md).
cd "$(dirname "$0")"
PORT="${1:-8471}"
echo "Serving site/ at http://localhost:$PORT"
exec python3 -m http.server "$PORT" --directory site
