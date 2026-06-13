import type { HarnessAlarm, AlarmSeverity, AlarmType } from "./types";

export class AlarmEmitter {
  private alarms: HarnessAlarm[] = [];
  private onAlarm?: (alarm: HarnessAlarm) => void;

  constructor(options?: { onAlarm?: (alarm: HarnessAlarm) => void }) {
    this.onAlarm = options?.onAlarm;
  }

  emit(params: {
    type: AlarmType | string;
    severity: AlarmSeverity;
    context: Record<string, unknown>;
    recommendedAction: string;
  }): HarnessAlarm {
    const alarm: HarnessAlarm = {
      type: params.type,
      severity: params.severity,
      context: params.context,
      recommendedAction: params.recommendedAction,
    };
    this.alarms.push(alarm);
    this.onAlarm?.(alarm);
    return alarm;
  }

  getAll(): HarnessAlarm[] {
    return [...this.alarms];
  }
}
