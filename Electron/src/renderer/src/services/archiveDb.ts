import { DroneData, FlightMeta, SavedFlight } from '../types';

export const saveFlightToDB = async (flight: SavedFlight): Promise<void> => {
  if (window.api?.saveFlight) {
    await window.api.saveFlight(flight);
  }
};

export const loadFlightMetasFromDB = async (): Promise<FlightMeta[]> => {
  if (window.api?.listFlights) {
    return await window.api.listFlights();
  }
  return [];
};

export const loadFlightDataById = async (id: number): Promise<DroneData[]> => {
  if (window.api?.loadFlight) {
    return (await window.api.loadFlight(id)) as DroneData[];
  }
  return [];
};

export const deleteFlightFromDB = async (id: number): Promise<void> => {
  if (window.api?.deleteFlight) {
    await window.api.deleteFlight(id);
  }
};

export const openArchiveDirectory = async (): Promise<void> => {
  if (window.api?.openArchiveFolder) {
    await window.api.openArchiveFolder();
  }
};