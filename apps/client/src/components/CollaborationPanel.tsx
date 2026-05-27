import type { EventRecord, RoomMember, TaskRecord } from "../types";

export function CollaborationPanel({
  members,
  events,
  tasks,
  chatText,
  onChatTextChange,
  onSendChat,
  onCreateMockAgentTask,
  onRunMockAgent
}: {
  members: RoomMember[];
  events: EventRecord[];
  tasks: TaskRecord[];
  chatText: string;
  onChatTextChange(value: string): void;
  onSendChat(): void;
  onCreateMockAgentTask(): void;
  onRunMockAgent(taskId: string): void;
}) {
  return (
    <div className="panel collab-panel">
      <div className="panel-header">Collaboration</div>
      <section>
        <h2>Members</h2>
        <ul className="member-list" data-testid="member-list">
          {members.map((member) => (
            <li key={member.id}>
              <span>{member.name}</span>
              <small>
                {member.kind} · {member.currentFile ?? "Browsing"}
              </small>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Agent Task</h2>
        <button onClick={onCreateMockAgentTask} data-testid="create-agent-task">
          Create MockAgent Task
        </button>
        <ul className="task-list" data-testid="task-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <strong>{task.title}</strong>
              <small>{task.status}</small>
              <button
                onClick={() => onRunMockAgent(task.id)}
                data-testid={`run-agent-${task.id}`}
              >
                Run MockAgent
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Activity</h2>
        <ol className="event-list" data-testid="event-list">
          {events.slice(-20).map((event) => (
            <li key={event.id}>{event.type}</li>
          ))}
        </ol>
      </section>
      <section className="chat-box">
        <h2>Chat</h2>
        <textarea
          value={chatText}
          onChange={(event) => onChatTextChange(event.target.value)}
          placeholder="@MockAgent help with this task"
          data-testid="chat-input"
        />
        <button onClick={onSendChat} data-testid="send-chat">
          Send
        </button>
      </section>
    </div>
  );
}
