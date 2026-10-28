import { ElectronAPI } from '@electron-toolkit/preload'

export interface DemTilePayload {
  key: string
  width: number
  height: number
  data: Float32Array | Int16Array
}

export interface DataPathsInfo {
  mbtilesPath: string | null
  demDirPath: string | null
}

export interface ArchiveBridgeAPI {
  listFlights: () => Promise<Array<{ id: number; name: string; frameCount: number }>>
  saveFlight: (flight: unknown) => Promise<boolean>
  loadFlight: (id: number) => Promise<unknown[]>
  deleteFlight: (id: number) => Promise<boolean>
  openArchiveFolder: () => Promise<void>
  getDemTile: (latFloor: number, lngFloor: number) => Promise<DemTilePayload | null>
  getPaths: () => Promise<DataPathsInfo>
  selectMbtiles: () => Promise<DataPathsInfo>
  selectDemDir: () => Promise<DataPathsInfo>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ArchiveBridgeAPI
  }
}