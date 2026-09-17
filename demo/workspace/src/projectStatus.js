export function createProjectStatus(tasks) {
  return {
    taskCount: tasks.length,
    completedCount: tasks.filter((task) => task.completed).length,
    nextTask: tasks.find((task) => !task.completed)?.title ?? "All tasks complete"
  };
}

export function formatProjectStatus(status) {
  return [
    "SimpleRCPv2 demo workspace",
    `Tasks: ${status.taskCount}`,
    `Completed: ${status.completedCount}`,
    `Next: ${status.nextTask}`
  ].join("\n");
}
