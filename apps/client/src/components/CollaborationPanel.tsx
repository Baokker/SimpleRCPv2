import type { EventRecord, RoomMember } from "../types";

export function CollaborationPanel({
  members,
  events,
  chatText,
  onChatTextChange,
  onSendChat
}: {
  members: RoomMember[];
  events: EventRecord[];
  chatText: string;
  onChatTextChange(value: string): void;
  onSendChat(): void;
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
              <small>{member.currentFile ?? "Browsing"}</small>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Activity</h2>
        <ol className="event-list" data-testid="event-list">
          {events.slice(-12).map((event) => (
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
