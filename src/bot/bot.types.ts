export interface UserSettings {
  normal: boolean;
  highroom: boolean;
  manual: boolean;
}

export interface User {
  username: string;
  settings: UserSettings;
}

export interface QueueState {
  mode: number;
  inQueue: number;
}

export interface OnlineStats {
  sessions: number;
  inGame: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  normal: true,
  highroom: true,
  manual: true,
};
