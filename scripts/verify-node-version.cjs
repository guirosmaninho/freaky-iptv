const major = Number.parseInt(process.versions.node.split('.')[0], 10);
const minor = Number.parseInt(process.versions.node.split('.')[1], 10);
const supported = major === 24 && minor >= 15;

if (!supported && process.env.FREAKYIPTV_ALLOW_UNSUPPORTED_NODE !== '1') {
  console.error(`Freaky IPTV requires Node >=24.15 <25 (received ${process.versions.node}).`);
  process.exit(1);
}
