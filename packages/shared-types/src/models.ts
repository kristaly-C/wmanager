import { LocationType, MovementType, SlotMode, Role, PurchaseOrderStatus, StockTransferStatus, StocktakeStatus, ReturnCaseStatus, SalesOrderStatus } from "./enums";

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

    primarySupplierId: string;
    imageUrls: string[];
    attributes: Record<string, string>;

    categoryId: string;

    isActive: boolean;
    createdAt: string;
    updatedAt: string;


}
export interface Supplier {
    id: string;
    name: string;
    description?: string;
    phone?: string;
    email?: string;
    createdAt: string;
    updatedAt: string;
}
export interface Category {
    id: string;
    name: string;
    parentId?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface User {
    id: string;
    email: string;
    name: string;
    role: Role;
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
    colors: string[];
    size: string;
    weight: number;

    price: number;
    costPrice: number;

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
    note?: string;

    createdAt: string;
    updatedAt: string;
}

export interface StockItem {
    id: string;
    locationId: string;
    variantId: string;

    quantity: number;
    reservedQuantity: number;

    minStockLevel?: number;
    maxStockLevel?: number;

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

export interface PurchaseOrder {
    id: string;
    supplierId: string;
    status: PurchaseOrderStatus;
    createdAt: string;
    updatedAt: string;
}

export interface StockTransfer {
    id: string;
    fromLocationId: string;
    toLocationId: string;
    status: StockTransferStatus;
    createdAt: string;
    updatedAt: string;
}

export interface StocktakeSession {
    id: string;
    locationId: string;
    status: StocktakeStatus;
    startedAt: string;
    completedAt?: string;
    performedByUserId: string;
    createdAt: string;
    updatedAt: string;
}

export interface ReturnCase {
    id: string;
    handledByUserId: string;
    status: ReturnCaseStatus;
    returnReason: string;
    resultNote?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    orderReference?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ReturnCaseItem {
    id: string;
    returnCaseId: string;
    variantId: string;
    quantity: number;
    createdAt: string;
}

export interface SalesOrder {
    id: string;
    status: SalesOrderStatus;
    createdAt: string;
    updatedAt: string;
}