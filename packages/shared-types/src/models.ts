import { LocationType, MovementType, SlotMode } from "./enums";

export interface Product {
    id: string;
    name: string;
    brand: string;
    gender: string;
    usageArea: string;
    material: string;
    model: string;
    manufacturerCode: string;
    functionality: string;

    vatRate: number;

    primarySupplier: string;
    imageUrls: string[];
    attributes: Record<string, string>;

    categoryId: string;
    categoryName: string;

    isActive: boolean;
    createdAt: string;
    updatedAt: string;


}

export interface ProductWithVariants extends Product {
    variants: Variant[];
}

export interface Variant {
    id: string;
    productId: string;

    sku: string;
    color: string;
    size: string;
    weight: number;

    price: number;
    costPrice: number;

    minStockLevel: number;
    maxStockLevel: number;

    isActive: boolean;
    createdAt: string;
    updatedAt: string;

}

export interface VariantWithStock extends Variant {
    stockItems: StockItem[];
    barcodes: VariantBarcode[];
}

export interface VariantBarcode {
    id: string;
    variantId: string;

    barcode: string;
    isPrimary: boolean;
    note: string;

    createdAt: string;
}

export interface StockItem {
    id: string;
    locationId: string;
    variantId: string;
    quantity: number;
    reservedQuantity: number;
    createdAt: string;
    updatedAt: string;
}

export interface Location {
    id: string;
    parentId?: string;
    name: string;
    description: string;
    type: LocationType;
    isActive: boolean;
    slotMode?: SlotMode;

    createdAt: string;
    updatedAt: string;
}

export interface StockMovement {
    id: string;
    variantId: string;
    locationId: string;
    quantity: number;
    type:MovementType;

    purchaseOrderId?: string;
    salesOrderId?: string;
    stocktakeSessionId?: string;
    stockTransferId?: string;
    returnCaseId?: string;

    note?: string;
    createdByUserId: string;
    createdAt: string;
}