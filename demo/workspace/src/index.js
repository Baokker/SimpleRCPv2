import { createProjectStatus, formatProjectStatus } from "./projectStatus.js";

const status = createProjectStatus([
  { title: "Open the workspace", completed: true },
  { title: "Edit a file together", completed: false },
  { title: "Run the shared terminal", completed: false }
]);

console.log(formatProjectStatus(status));
