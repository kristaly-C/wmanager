export function normalizeScannedBarcode(raw: string): string {
    return raw.trim().replace(/[öÖ]/g, '0').replace(/[üÜ]/g, '-');
}

function swapYz(value: string): string {
    return value
        .replace(/y/g, '__LOWER_Z__')
        .replace(/z/g, 'y')
        .replace(/__LOWER_Z__/g, 'z')
        .replace(/Y/g, '__UPPER_Z__')
        .replace(/Z/g, 'Y')
        .replace(/__UPPER_Z__/g, 'Z');
}

export function getBarcodeSearchVariants(raw: string): string[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    const candidates = new Set<string>([trimmed]);
    const huFixed = normalizeScannedBarcode(trimmed);
    if (huFixed) {
        candidates.add(huFixed);
    }

    const compact = huFixed.replace(/\s+/g, '');
    if (compact) {
        candidates.add(compact);
        if (/^\d{12}$/.test(compact)) {
            candidates.add(`0${compact}`);
        } else if (/^0\d{12}$/.test(compact)) {
            candidates.add(compact.slice(1));
        }
    }

    if (
        !/\s/.test(huFixed) &&
        /[yYzZ]/.test(huFixed) &&
        (/\d/.test(huFixed) || /^[A-Za-z0-9_-]{4,}$/.test(huFixed))
    ) {
        const swapped = swapYz(huFixed);
        if (swapped) {
            candidates.add(swapped);
        }
    }

    return Array.from(candidates).filter((c) => c.length > 0);
}

export function buildVariantBarcodeOrClauses(raw: string) {
    return getBarcodeSearchVariants(raw).map((code) => ({
        variantBarcodes: {
            some: {
                barcode: {
                    contains: code,
                    mode: 'insensitive' as const,
                },
            },
        },
    }));
}

export function buildVariantSkuOrClauses(raw: string) {
    return getBarcodeSearchVariants(raw).map((code) => ({
        sku: {
            contains: code,
            mode: 'insensitive' as const,
        },
    }));
}

export function buildVariantSupplierSkuOrClauses(raw: string) {
    return getBarcodeSearchVariants(raw).map((code) => ({
        variantSuppliers: {
            some: {
                supplierSku: {
                    contains: code,
                    mode: 'insensitive' as const,
                },
            },
        },
    }));
}
