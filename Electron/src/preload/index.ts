import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  listFlights: () => ipcRenderer.invoke('archive:list'),
  saveFlight: (flight: unknown) => ipcRenderer.invoke('archive:save', flight),
  loadFlight: (id: number) => ipcRenderer.invoke('archive:load', id),
  deleteFlight: (id: number) => ipcRenderer.invoke('archive:delete', id),
  openArchiveFolder: () => ipcRenderer.invoke('archive:open-folder'),
  getDemTile: (latFloor: number, lngFloor: number) =>
    ipcRenderer.invoke('dem:get-tile', latFloor, lngFloor),
  getPaths: () => ipcRenderer.invoke('settings:get-paths'),
  selectMbtiles: () => ipcRenderer.invoke('settings:select-mbtiles'),
  selectDemDir: () => ipcRenderer.invoke('settings:select-dem')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}