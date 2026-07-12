import { useState } from "react";
import type {
  AgentRun,
  ChatMessage,
  EventRecord,
  RoomMember,
  RuntimeConfig,
  ScenarioSummary,
  TaskRecord,
  TimelineItem
} from "../types";

type CollaborationTab = "chat" | "team" | "runs" | "timeline" | "tasks";

const tabs: Array<{ id: CollaborationTab; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "team", label: "Team" },
  { id: "runs", label: "Runs" },
  { id: "timeline", label: "Timeline" },
  { id: "tasks", label: "Tasks" }
];

export function CollaborationPanel({
  members,
  events,
  tasks,
  chatMessages,
  agentRuns,
  timeline,
  scenarios,
  selectedScenario,
  chatText,
  runtimeConfig,
  onChatTextChange,
  onSendChat,
  onSelectedScenarioChange,
  onRunScenario,
  onCreateMockAgentTask,
  onRunMockAgent,
  onRunConfiguredAgent
}: {
  members: RoomMember[];
  events: EventRecord[];
  tasks: TaskRecord[];
  chatMessages: ChatMessage[];
  agentRuns: AgentRun[];
  timeline: TimelineItem[];
  scenarios: ScenarioSummary[];
  selectedScenario: string;
  chatText: string;
  runtimeConfig: RuntimeConfig;
  onChatTextChange(value: string): void;
  onSendChat(): void;
  onSelectedScenarioChange(value: string): void;
  onRunScenario(): void;
  onCreateMockAgentTask(): void;
  onRunMockAgent(taskId: string): void;
  onRunConfiguredAgent(taskId: string): void;
}) {
  const [activeTab, setActiveTab] = useState<CollaborationTab>("chat");
  const mentionHint = runtimeConfig.agentMentionAliases[0] ?? runtimeConfig.agentName;
  const configuredLabel = runtimeConfig.agentConfigured
    ? `${runtimeConfig.agentName} ready`
    : `${runtimeConfig.agentName} needs API key`;

  return (
    <div className="panel collab-panel">
      <div className="panel-header">Collaboration</div>
      <nav className="collab-tabs" aria-label="Collaboration sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
            data-testid={`collab-tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="collab-tab-body">
        {activeTab === "chat" ? (
          <section className="collab-section chat-section">
            <h2>Chat</h2>
            <div className="agent-hint" data-testid="agent-mention-hint">
              @{mentionHint} · {configuredLabel}
            </div>
            <ol className="chat-transcript" data-testid="chat-transcript">
              {chatMessages.map((message) => (
                <li key={message.id} className={`chat-message ${message.authorKind}`}>
                  <span>
                    <strong>{message.authorName}</strong>
                    <time>{formatTime(message.timestamp)}</time>
                  </span>
                  <p>{message.text}</p>
                </li>
              ))}
            </ol>
            <div className="chat-box" data-testid="chat-composer">
              <textarea
                value={chatText}
                onChange={(event) => onChatTextChange(event.target.value)}
                placeholder={`@${mentionHint} help with this task`}
                data-testid="chat-input"
              />
              <button onClick={onSendChat} data-testid="send-chat">
                Send
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === "team" ? (
          <section className="collab-section members-section">
            <h2>People</h2>
            <ul className="member-list" data-testid="member-list">
              {members.map((member) => (
                <li key={member.id}>
                  <span>
                    <i className={member.online ? "status-dot online" : "status-dot"} />
                    <strong>{member.displayName ?? member.name}</strong>
                    {member.connectionCount > 1 ? (
                      <em>{member.connectionCount} tabs</em>
                    ) : null}
                  </span>
                  <small>
                    {member.kind} · {member.currentFile ?? "Browsing"}
                  </small>
                </li>
              ))}
            </ul>
            <h2>Activity</h2>
            <ol className="event-list" data-testid="activity-feed">
              {events.slice(-12).map((event) => (
                <li key={event.id}>{event.type}</li>
              ))}
            </ol>
          </section>
        ) : null}

        {activeTab === "runs" ? (
          <section className="collab-section agent-runs-section">
            <h2>Agent Runs</h2>
            <ul className="agent-run-list" data-testid="agent-runs">
              {agentRuns.length === 0 ? (
                <li className="muted-row">No agent runs yet.</li>
              ) : (
                agentRuns.map((run) => (
                  <li key={run.id}>
                    <span>
                      <strong>{run.agentName}</strong>
                      <em>{run.status.replace("_", " ")}</em>
                    </span>
                    <small>{run.lastAction ?? run.summary ?? "Queued"}</small>
                  </li>
                ))
              )}
            </ul>
          </section>
        ) : null}

        {activeTab === "timeline" ? (
          <section className="collab-section timeline-section">
            <h2>Scenario</h2>
            <div className="scenario-controls">
              <select
                value={selectedScenario}
                onChange={(event) => onSelectedScenarioChange(event.target.value)}
                data-testid="scenario-select"
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
              <button
                onClick={onRunScenario}
                disabled={!selectedScenario}
                data-testid="run-scenario"
              >
                Run
              </button>
            </div>
            <h2>Timeline</h2>
            <ol className="timeline-list" data-testid="timeline-list">
              {timeline.length === 0 ? (
                <li className="muted-row">No replayable activity yet.</li>
              ) : (
                timeline.map((item) => (
                  <li key={item.id} className={item.status}>
                    <span>
                      <strong>{item.actorName}</strong>
                      <em>{item.type}</em>
                    </span>
                    <p>{item.label}</p>
                  </li>
                ))
              )}
            </ol>
          </section>
        ) : null}

        {activeTab === "tasks" ? (
          <section className="collab-section agent-section">
            <h2>Tasks</h2>
            <button onClick={onCreateMockAgentTask} data-testid="create-agent-task">
              Create MockAgent Task
            </button>
            <ul className="task-list" data-testid="task-list">
              {tasks.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  <small>{task.status}</small>
                  <div className="task-actions">
                    <button
                      onClick={() => onRunMockAgent(task.id)}
                      data-testid={`run-agent-${task.id}`}
                    >
                      Run Mock
                    </button>
                    <button
                      onClick={() => onRunConfiguredAgent(task.id)}
                      data-testid={`run-configured-agent-${task.id}`}
                    >
                      Run Provider
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}
