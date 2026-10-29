# Freaky IPTV website

This directory contains the static public website, separate from the Electron
application. Download links point to the latest GitHub release, so publishing
an application release does not require rebuilding the website.

## Preview

Serve this directory with any static HTTP server, for example:

```sh
cd website
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080`. This local preview does not apply the nginx
security headers used by the container.

## Docker and Dockhand

`compose.yaml` builds only this directory and runs an unprivileged nginx
container. It publishes no host port and uses no persistent volumes. It joins
the existing external Docker network `guirosmaninho-website_guirosmaninho`;
set `FREAKY_INGRESS_NETWORK` if the correct network has another name. The
network must already exist, and the Cloudflare tunnel connectors must also be
attached to it.

For a Dockhand Git stack, select this repository and the intended branch, and
use `website/compose.yaml` as the compose file. Verify that the build context
resolves to `website/`. Once the stack is running, configure the existing
Cloudflare tunnel hostname `freakyiptv.guirosmaninho.com` to route to
`http://freaky-iptv-site:8080`, then verify public HTTPS and both connectors.
Do not recreate the shared network, stop existing tunnel containers, or change
other stacks. Check the real tunnel and DNS configuration before changing it.

The hostname, DNS record and Cloudflare route are external configuration; this
repository does not create them. Do not include tunnel credentials in the
repository or Compose file.

The screenshots use fictional demonstration data. Refresh them from a
disposable app data directory, and inspect them for private information before
publishing any replacements.
