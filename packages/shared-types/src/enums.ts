export enum SlotMode {
    DEDICATED = 'DEDICATED',
    MIXED = 'MIXED'
}

export enum Role {
    ADMIN = 'ADMIN',
    STORE_MANAGER = 'STORE_MANAGER',
    WAREHOUSE_MANAGER = 'WAREHOUSE_MANAGER',
    WAREHOUSE_STAFF = 'WAREHOUSE_STAFF',
    STORE_STAFF = 'STORE_STAFF',
    ORDER_CLERK = 'ORDER_CLERK',
    RMA_CLERK = 'RMA_CLERK',
}

export enum LocationType {
    WAREHOUSE = 'WAREHOUSE',
    STORE = 'STORE',
    ZONE = 'ZONE',
    SHELF = 'SHELF',
  }

  export enum MovementType {
    PURCHASE_RECEIPT = 'PURCHASE_RECEIPT',       // beérkezés beszállítótól
    SALE = 'SALE',                               // eladás (webshop/bolt)
    TRANSFER_OUT = 'TRANSFER_OUT',               // kiszállítás transzferhez
    TRANSFER_IN = 'TRANSFER_IN',                 // beérkezés transzferből
    STOCKTAKE_ADJUSTMENT = 'STOCKTAKE_ADJUSTMENT', // leltárkorrekció
    RETURN_RESTOCK = 'RETURN_RESTOCK',           // visszavétel, visszakerül készletre
    MANUAL_CORRECTION = 'MANUAL_CORRECTION',     // kézi javítás (pl. sérült áru leírása)
  }
  export enum PurchaseOrderStatus {
    PENDING = 'PENDING',
    RECEIVED = 'RECEIVED',
    CANCELLED = 'CANCELLED',
  }
  export enum StockTransferStatus {
    PENDING = 'PENDING',
    IN_TRANSIT = 'IN_TRANSIT',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
  }
  export enum StocktakeStatus {
    IN_PROGRESS = 'IN_PROGRESS',
    WAITING_FOR_APPROVAL = 'WAITING_FOR_APPROVAL',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
  }
  export enum ReturnCaseStatus {
    CREATED = 'CREATED',
    IN_PROGRESS = 'IN_PROGRESS',
    APPROVED = 'APPROVED',
    DECLINED = 'DECLINED',
  }
  export enum SalesOrderStatus {
    PENDING = 'PENDING',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
  }