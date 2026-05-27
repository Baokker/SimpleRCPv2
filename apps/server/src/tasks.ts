import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import type { TaskRecord } from "./types.js";

export interface CreateTaskInput {
  roomId: string;
  title: string;
  description: string;
  creatorId: string;
  assigneeId: string;
  editablePaths: string[];
  commandWhitelist: string[];
  acceptanceTarget?: string;
}

export function createTaskStore(events: EventLog) {
  const tasks = new Map<string, TaskRecord>();

  return {
    createTask(input: CreateTaskInput) {
      const task: TaskRecord = {
        id: nanoid(10),
        status: "open",
        ...input
      };
      tasks.set(task.id, task);
      events.append({
        type: "task_created",
        roomId: task.roomId,
        taskId: task.id,
        memberId: task.creatorId,
        payload: {
          title: task.title,
          assigneeId: task.assigneeId,
          editablePaths: task.editablePaths,
          commandWhitelist: task.commandWhitelist
        }
      });
      return task;
    },
    getTask(taskId: string) {
      return tasks.get(taskId);
    },
    listTasks(roomId?: string) {
      const allTasks = [...tasks.values()];
      return roomId
        ? allTasks.filter((task) => task.roomId === roomId)
        : allTasks;
    },
    canEdit(taskId: string, filePath: string) {
      const task = tasks.get(taskId);
      if (!task) return false;
      return task.editablePaths.some((pattern) => matchesGlob(pattern, filePath));
    },
    canRunCommand(taskId: string, command: string) {
      const task = tasks.get(taskId);
      return task?.commandWhitelist.includes(command) ?? false;
    },
    markRunning(taskId: string) {
      const task = tasks.get(taskId);
      if (!task) throw new Error("Task not found");
      task.status = "running";
      events.append({ type: "task_started", roomId: task.roomId, taskId });
      return task;
    },
    markCompleted(taskId: string, summary: string) {
      const task = tasks.get(taskId);
      if (!task) throw new Error("Task not found");
      task.status = "completed";
      events.append({
        type: "task_completed",
        roomId: task.roomId,
        taskId,
        payload: { summary }
      });
      return task;
    }
  };
}

function matchesGlob(pattern: string, filePath: string) {
  if (pattern.endsWith("/**")) {
    return filePath.startsWith(pattern.slice(0, -3));
  }
  return pattern === filePath;
}

export type TaskStore = ReturnType<typeof createTaskStore>;
