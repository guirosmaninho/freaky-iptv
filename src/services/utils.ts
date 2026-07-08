export function sha256Short(value: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i, j;

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  // Convert string to UTF-8 bytes
  const asciiBytes: number[] = [];
  const valToHash = value || '';
  for (i = 0; i < valToHash.length; i++) {
    const code = valToHash.charCodeAt(i);
    if (code < 128) {
      asciiBytes.push(code);
    } else if (code < 2048) {
      asciiBytes.push((code >> 6) | 192, (code & 63) | 128);
    } else {
      asciiBytes.push((code >> 12) | 224, ((code >> 6) & 63) | 128, (code & 63) | 128);
    }
  }

  const asciiBytesLength = asciiBytes.length;
  // Append a 1 bit, then pad with 0s to 512-bit block
  asciiBytes.push(0x80);
  while ((asciiBytes.length + 8) % 64 !== 0) {
    asciiBytes.push(0);
  }
  
  // Append length in bits as 64-bit big-endian integer
  const totalBits = asciiBytesLength * 8;
  const lengthBuffer = new ArrayBuffer(8);
  const view = new DataView(lengthBuffer);
  view.setUint32(0, Math.floor(totalBits / maxWord));
  view.setUint32(4, totalBits % maxWord);
  for (i = 0; i < 8; i++) {
    asciiBytes.push(view.getUint8(i));
  }

  // Process the message in successive 512-bit blocks
  for (i = 0; i < asciiBytes.length; i += 64) {
    const w: number[] = [];
    for (j = 0; j < 16; j++) {
      w[j] = (asciiBytes[i + j * 4] << 24) |
             (asciiBytes[i + j * 4 + 1] << 16) |
             (asciiBytes[i + j * 4 + 2] << 8) |
             (asciiBytes[i + j * 4 + 3]);
    }
    for (j = 16; j < 64; j++) {
      const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (j = 0; j < 64; j++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  let hex = '';
  for (i = 0; i < 8; i++) {
    const val = hash[i] >>> 0;
    hex += val.toString(16).padStart(8, '0');
  }
  return hex.slice(0, 16).toLowerCase();
}

export function normalizeKey(value: string): string {
  if (!value) return '';
  return value
    .normalize('NFD') // Normalizes decomposed diacritics
    .replace(/[\u0300-\u036f]/g, '') // Removes NonSpacingMark diacritics
    .replace(/[^a-zA-Z0-9]/g, '') // Keeps only alphanumeric characters
    .toLowerCase();
}

const MODIFIER_CHARACTER_MAP: Record<string, string> = {
  'ᵃ': 'a', 'ᵇ': 'b', 'ᶜ': 'c', 'ᵈ': 'd', 'ᵉ': 'e', 'ᶠ': 'f', 'ᵍ': 'g',
  'ʰ': 'h', 'ⁱ': 'i', 'ʲ': 'j', 'ᵏ': 'k', 'ˡ': 'l', 'ᵐ': 'm', 'ⁿ': 'n',
  'ᵒ': 'o', 'ᵖ': 'p', 'ʳ': 'r', 'ˢ': 's', 'ᵗ': 't', 'ᵘ': 'u', 'ᵛ': 'v',
  'ʷ': 'w', 'ˣ': 'x', 'ʸ': 'y', 'ᶻ': 'z',
  'ᴬ': 'a', 'ᴮ': 'b', 'ᴰ': 'd', 'ᴱ': 'e', 'ᴳ': 'g', 'ᴴ': 'h', 'ᴵ': 'i',
  'ᴶ': 'j', 'ᴷ': 'k', 'ᴸ': 'l', 'ᴹ': 'm', 'ᴺ': 'n', 'ᴼ': 'o', 'ᴾ': 'p',
  'ᴿ': 'r', 'ᵀ': 't', 'ᵁ': 'u', 'ⱽ': 'v', 'ᵂ': 'w'
};

function normalizeChannelQualityText(name: string): string {
  const clean = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let mapped = '';

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    mapped += MODIFIER_CHARACTER_MAP[char] || char;
  }

  return mapped.toLowerCase().replace(/^[a-z]{2}\s*:\s*/, '');
}

export function getChannelBaseName(name: string, mappings?: Record<string, string>): string {
  if (!name) return '';
  let clean = normalizeChannelQualityText(name);
  
  // Assemble keywords to strip
  const keywordsToStrip: RegExp[] = [
    /\[|\]|\(|\)|-|\+|\|/g // remove bracket delimiters
  ];

  const allKeywords = new Set<string>();
  if (mappings) {
    for (const key in mappings) {
      const labels = mappings[key].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      for (const kw of labels) {
        allKeywords.add(kw);
      }
    }
  } else {
    // Default fallback list of keywords if no custom mappings
    const defaults = [
      'fhd', 'hd', 'sd', '4k', 'uhd', 'raw', 'hevc', 'h265', 'h264', 'h.264', 'h.265',
      '1080p', '720p', '480p', '576p', '2160p', '360p',
      '1080', '720', '576', '480', '360', '2160',
      'backup', 'temp', 'test', 'mobile', 'high', 'low', 'full', 'fullhd', 'compat'
    ];
    for (const kw of defaults) {
      allKeywords.add(kw);
    }
  }

  // Also include general video codecs that are good to strip regardless
  const codecs = ['hevc', 'h265', 'h264', 'h.264', 'h.265', 'raw'];
  for (const c of codecs) {
    allKeywords.add(c);
  }

  for (const kw of allKeywords) {
    const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    // Strip keyword as a whole word (using non-alphanumeric boundary check)
    keywordsToStrip.push(new RegExp('(?:^|[^a-zA-Z0-9])' + escaped + '(?=$|[^a-zA-Z0-9])', 'gi'));
  }
  
  for (const kw of keywordsToStrip) {
    clean = clean.replace(kw, ' ');
  }
  return clean.replace(/\s+/g, ' ').trim();
}

export function getChannelBaseNamePreserveCase(name: string, mappings?: Record<string, string>): string {
  if (!name) return '';
  
  // 1. Normalize modifier characters
  const cleanModifiers = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let mapped = '';
  for (let i = 0; i < cleanModifiers.length; i++) {
    const char = cleanModifiers[i];
    mapped += MODIFIER_CHARACTER_MAP[char] || char;
  }
  
  // 2. Remove country prefixes like "PT:", "ES -", "PT - ", "PT |" case-insensitively
  let clean = mapped.replace(/^[a-zA-Z]{2}\s*[:|-]\s*/, '').trim();

  // 3. Assemble keywords to strip
  const keywordsToStrip: RegExp[] = [
    /\[|\]|\(|\)|-|\+|\|/g // remove bracket delimiters
  ];

  const allKeywords = new Set<string>();
  if (mappings) {
    for (const key in mappings) {
      const labels = mappings[key].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      for (const kw of labels) {
        allKeywords.add(kw);
      }
    }
  } else {
    const defaults = [
      'fhd', 'hd', 'sd', '4k', 'uhd', 'raw', 'hevc', 'h265', 'h264', 'h.264', 'h.265',
      '1080p', '720p', '480p', '576p', '2160p', '360p',
      '1080', '720', '576', '480', '360', '2160',
      'backup', 'temp', 'test', 'mobile', 'high', 'low', 'full', 'fullhd', 'compat'
    ];
    for (const kw of defaults) {
      allKeywords.add(kw);
    }
  }

  const codecs = ['hevc', 'h265', 'h264', 'h.264', 'h.265', 'raw'];
  for (const c of codecs) {
    allKeywords.add(c);
  }

  for (const kw of allKeywords) {
    const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    keywordsToStrip.push(new RegExp('(?:^|[^a-zA-Z0-9])' + escaped + '(?=$|[^a-zA-Z0-9])', 'gi'));
  }

  for (const kw of keywordsToStrip) {
    clean = clean.replace(kw, ' ');
  }

  return clean.replace(/\s+/g, ' ').trim();
}

export function getChannelQualityLabel(name: string, mappings?: Record<string, string>): string {
  const lower = normalizeChannelQualityText(name);

  const defaultMappings: Record<string, string> = {
    '4K': '4k, 2160p, uhd',
    'FHD': 'fhd, 1080p, 1080',
    'HEVC': 'hevc, h265, h.265',
    'HD': 'hd, 720p, 720',
    'SD': 'sd, 576p, 480p, 576, 480',
    'Low': 'low, mobile',
    'Backup': 'backup'
  };
  const activeMappings = { ...defaultMappings, ...(mappings || {}) };

  const order = ['4K', 'FHD', 'HEVC', 'HD', 'SD', 'Low', 'Backup'];
  for (const key of order) {
    const labelsStr = activeMappings[key];
    if (!labelsStr) continue;
    const labels = labelsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    for (const label of labels) {
      const escaped = label.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp('(?:^|[^a-zA-Z0-9])' + escaped + '(?=$|[^a-zA-Z0-9])');
      if (regex.test(lower)) {
        return key;
      }
    }
  }

  return 'Source';
}

export function getQualityScore(label: string): number {
  switch (label) {
    case '4K': return 100;
    case 'FHD': return 80;
    case 'HEVC': return 70;
    case 'HD': return 60;
    case 'SD': return 40;
    case 'Low': return 30;
    case 'Backup': return 20;
    default: return 50;
  }
}
