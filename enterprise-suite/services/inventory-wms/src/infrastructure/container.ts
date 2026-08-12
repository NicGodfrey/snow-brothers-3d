import { CycleCountService } from "../application/cycle-count-service.js";
import { ReservationService } from "../application/reservation-service.js";
import { StockService } from "../application/stock-service.js";
import { TaskService } from "../application/task-service.js";
import { WarehouseService } from "../application/warehouse-service.js";
import {
  MemoryBinRepository,
  MemoryCycleCountRepository,
  MemoryInventoryTransactionRepository,
  MemoryLotRepository,
  MemoryPickTaskRepository,
  MemoryPutawayTaskRepository,
  MemoryReservationRepository,
  MemorySerialRepository,
  MemoryStockBalanceRepository,
  MemoryWarehouseRepository,
  MemoryZoneRepository,
} from "./memory/repositories.js";
import { InMemoryOutbox } from "./memory/outbox.js";

export interface InventoryModule {
  repositories: {
    warehouses: MemoryWarehouseRepository;
    zones: MemoryZoneRepository;
    bins: MemoryBinRepository;
    lots: MemoryLotRepository;
    serials: MemorySerialRepository;
    balances: MemoryStockBalanceRepository;
    transactions: MemoryInventoryTransactionRepository;
    reservations: MemoryReservationRepository;
    cycleCounts: MemoryCycleCountRepository;
    putawayTasks: MemoryPutawayTaskRepository;
    pickTasks: MemoryPickTaskRepository;
  };
  outbox: InMemoryOutbox;
  warehouseService: WarehouseService;
  stockService: StockService;
  reservationService: ReservationService;
  cycleCountService: CycleCountService;
  taskService: TaskService;
}

/** Composition root: wires the in-memory adapters into the application services. */
export function createInventoryModule(): InventoryModule {
  const warehouses = new MemoryWarehouseRepository();
  const zones = new MemoryZoneRepository();
  const bins = new MemoryBinRepository();
  const lots = new MemoryLotRepository();
  const serials = new MemorySerialRepository();
  const balances = new MemoryStockBalanceRepository();
  const transactions = new MemoryInventoryTransactionRepository();
  const reservations = new MemoryReservationRepository();
  const cycleCounts = new MemoryCycleCountRepository();
  const putawayTasks = new MemoryPutawayTaskRepository();
  const pickTasks = new MemoryPickTaskRepository();
  const outbox = new InMemoryOutbox();

  const warehouseService = new WarehouseService(warehouses, zones, bins, outbox);
  const stockService = new StockService(
    warehouses,
    bins,
    lots,
    serials,
    balances,
    transactions,
    putawayTasks,
    outbox,
  );
  const reservationService = new ReservationService(
    reservations,
    balances,
    bins,
    lots,
    transactions,
    stockService,
    outbox,
  );
  const cycleCountService = new CycleCountService(
    cycleCounts,
    balances,
    bins,
    stockService,
    outbox,
  );
  const taskService = new TaskService(putawayTasks, pickTasks, reservations, stockService, outbox);

  return {
    repositories: {
      warehouses,
      zones,
      bins,
      lots,
      serials,
      balances,
      transactions,
      reservations,
      cycleCounts,
      putawayTasks,
      pickTasks,
    },
    outbox,
    warehouseService,
    stockService,
    reservationService,
    cycleCountService,
    taskService,
  };
}
