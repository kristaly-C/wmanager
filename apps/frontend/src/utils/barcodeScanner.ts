export function normalizeScannedBarcode(raw: string): string {
  return raw.trim().replace(/[öÖ]/g, '0').replace(/[üÜ]/g, '-')
}

function swapYz(value: string): string {
  return value
    .replace(/y/g, '__LOWER_Z__')
    .replace(/z/g, 'y')
    .replace(/__LOWER_Z__/g, 'z')
    .replace(/Y/g, '__UPPER_Z__')
    .replace(/Z/g, 'Y')
    .replace(/__UPPER_Z__/g, 'Z')
}

export function getBarcodeCandidates(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []

  const candidates = new Set<string>([trimmed])
  const huFixed = normalizeScannedBarcode(trimmed)
  if (huFixed) {
    candidates.add(huFixed)
  }

  const compact = huFixed.replace(/\s+/g, '')
  if (compact) {
    candidates.add(compact)
    if (/^\d{12}$/.test(compact)) {
      candidates.add(`0${compact}`)
    } else if (/^0\d{12}$/.test(compact)) {
      candidates.add(compact.slice(1))
    }
  }

  if (
    !/\s/.test(huFixed) &&
    /[yYzZ]/.test(huFixed) &&
    (/\d/.test(huFixed) || /^[A-Za-z0-9_-]{4,}$/.test(huFixed))
  ) {
    const swapped = swapYz(huFixed)
    if (swapped) {
      candidates.add(swapped)
    }
  }

  return Array.from(candidates).filter((c) => c.length > 0)
}

export function matchesBarcodeExact(
  rawInput: string,
  barcodes?: ReadonlyArray<{ barcode: string }>,
): boolean {
  if (!barcodes || barcodes.length === 0) return false
  const candidatesLower = getBarcodeCandidates(rawInput).map((c) => c.toLowerCase())
  if (candidatesLower.length === 0) return false

  return barcodes.some((entry) => {
    const barcodeLower = entry.barcode.trim().toLowerCase()
    return candidatesLower.includes(barcodeLower)
  })
}

export function matchesBarcodeOrSku(
  rawInput: string,
  sku: string,
  barcodes?: ReadonlyArray<{ barcode: string }>,
): boolean {
  const candidatesLower = getBarcodeCandidates(rawInput).map((c) => c.toLowerCase())
  if (candidatesLower.length === 0) return false

  if (candidatesLower.includes(sku.trim().toLowerCase())) {
    return true
  }
  return matchesBarcodeExact(rawInput, barcodes)
}
