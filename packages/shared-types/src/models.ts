import { LocationType, MovementType, SlotMode, Role, PurchaseOrderStatus, GoodsReceiptStatus, StockTransferStatus, StocktakeStatus, ReturnCaseStatus, SalesOrderStatus, SalesChannel, PickTaskStatus, StockReportStatus } from "./enums";

export interface Product {
    id: string;
    name: string;
    brandId: string;
    gender?: string | null;
    usageArea?: string | null;
    material?: string | null;
    model?: string | null;
    manufacturerCode?: string | null;
    functionality?: string | null;
    description?: string | null;
    vatRate: number;

    unit: string;
    vtszCode?: string | null;
    originCountry?: string | null;
    importantNote?: string | null;
    season?: string | null;
    isSerialized: boolean;
    isPurchasable: boolean;

    primarySupplierId: string;
    imageUrls: string[];
    attributes?: Record<string, string> | null;

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
    size?: string | null;
    weight?: number | null;
    netWeight?: number | null;
    volume?: number | null;
    imageUrls: string[];

    netPrice: number;
    grossPrice: number;
    costPrice?: number;
    costCurrency?: string;
    lastPurchasePrice?: number | null;
    lastPurchaseAt?: string | null;

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
    description?: string;
    type: LocationType;
    isActive: boolean;
    slotMode?: SlotMode;
    canFulfillWebshop?: boolean;
    fulfillmentPriority?: number;

    createdAt: string;
    updatedAt: string;
}

export interface StockMovement {
    id: string;
    variantId: string;
    locationId: string;
    quantity: number;
    type: MovementType;

    purchaseOrderId?: string | null;
    goodsReceiptId?: string | null;
    salesOrderId?: string | null;
    pickTaskId?: string | null;
    stocktakeSessionId?: string | null;
    stockTransferId?: string | null;
    returnCaseId?: string | null;

    unitCostHuf?: number | null;
    unitPriceHuf?: number | null;
    reversedMovementId?: string | null;

    note?: string | null;
    createdByUserId: string;
    createdAt: string;
}

export interface PurchaseOrder {
    id: string;
    orderNumber: string;
    supplierId: string;
    status: PurchaseOrderStatus;
    currency: string;
    exchangeRate?: number;
    supplierReference?: string | null;
    orderedAt?: string | null;
    confirmedAt?: string | null;
    expectedDeliveryDate?: string | null;
    note?: string | null;
    createdByUserId?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PurchaseOrderItem {
    id: string;
    purchaseOrderId: string;
    variantId: string;
    orderedQuantity: number;
    confirmedQuantity?: number | null;
    receivedQuantity: number;
    unitCost?: number;
    note?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PurchaseOrderWithItems extends PurchaseOrder {
    items: PurchaseOrderItem[];
}

export interface VariantSupplier {
    id: string;
    variantId: string;
    supplierId: string;
    supplierSku?: string | null;
    supplierProductName?: string | null;
    purchasePrice?: number;
    currency?: string;
    discountPercent?: number | null;
    orderUnit?: string | null;
    isPrimary: boolean;
    note?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface GoodsReceipt {
    id: string;
    receiptNumber: string;
    purchaseOrderId?: string | null;
    supplierId?: string | null;
    targetLocationId: string;
    invoiceNumber?: string | null;
    currency?: string;
    exchangeRate?: number;
    status: GoodsReceiptStatus;
    discrepancyNote?: string | null;
    note?: string | null;
    createdByUserId: string;
    approvedByUserId?: string | null;
    approvedAt?: string | null;
    completedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface GoodsReceiptItem {
    id: string;
    goodsReceiptId: string;
    purchaseOrderItemId?: string | null;
    variantId: string;
    expectedQuantity: number;
    receivedQuantity: number;
    unitCost?: number;
    unitCostHuf?: number;
    expectedLocationId?: string | null;
    isUnexpected: boolean;
    note?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface GoodsReceiptWithItems extends GoodsReceipt {
    items: GoodsReceiptItem[];
}

export interface VariantMonthlyStat {
    id: string;
    variantId: string;
    productId: string;
    year: number;
    month: number;
    purchasedQty: number;
    purchasedTotalCostHuf: number;
    soldQty: number;
    soldRevenueHuf: number;
    soldCogsHuf: number;
    returnedQty: number;
    adjustmentQty: number;
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
    orderNumber: string;
    externalOrderRef?: string | null;
    channel: SalesChannel;
    isPickup: boolean;
    status: SalesOrderStatus;
    sourceLocationId: string;
    transferRequestedFromLocationId?: string | null;
    holdReason?: string | null;
    customerName: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    shippingAddress?: string | null;
    note?: string | null;
    createdByUserId?: string | null;
    completedByUserId?: string | null;
    completedAt?: string | null;
    cancelledAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface SalesOrderItem {
    id: string;
    salesOrderId: string;
    variantId: string;
    orderedQuantity: number;
    reservedQuantity: number;
    pickedQuantity: number;
    unitNetPrice: number;
    unitGrossPrice: number;
    vatRate: number;
    discountPercent?: number | null;
    note?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface SalesOrderWithItems extends SalesOrder {
    items: SalesOrderItem[];
}

export interface PickTask {
    id: string;
    taskNumber: string;
    salesOrderId: string;
    sourceLocationId: string;
    zoneId?: string | null;
    status: PickTaskStatus;
    assignedToUserId?: string | null;
    toteCode?: string | null;
    dropoffLocationId?: string | null;
    dropoffCode?: string | null;
    startedAt?: string | null;
    droppedAt?: string | null;
    completedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PickTaskItem {
    id: string;
    pickTaskId: string;
    salesOrderItemId: string;
    variantId: string;
    suggestedLocationId?: string | null;
    requiredQuantity: number;
    pickedQuantity: number;
    createdAt: string;
    updatedAt: string;
}

export interface PickTaskWithItems extends PickTask {
    items: PickTaskItem[];
}

export interface Brand  {
    id: string;
    name: string;
    description?: string;

    createdAt: string;
    updatedAt: string;
}

export interface StockReport {
    id: string;
    variantId: string;
    locationId: string;
    expectedQuantity: number;
    foundQuantity: number;
    reason: string;
    status: StockReportStatus;
    reportedByUserId: string;
    resolvedByUserId?: string | null;
    resolutionNote?: string | null;
    resolvedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}
