import type { MissionControlItem } from "../../../shared/types";
import type { MissionControlData } from "./useMissionControlData";

interface MCOverviewTabProps {
  data: MissionControlData;
}

const CATEGORY_LABELS: Record<string, string> = {
  attention: "Attention",
  work: "Work",
  reviews: "Reviews",
  learnings: "Learnings",
  awareness: "Awareness",
  evidence: "Evidence",
};

function itemTone(item: MissionControlItem): string {
  if (item.severity === "failed") return "danger";
  if (item.severity === "action_needed") return "attention";
  if (item.severity === "successful") return "healthy";
  return "";
}

function BriefItem({
  item,
  formatRelativeTime,
  onOpenTask,
}: {
  item: MissionControlItem;
  formatRelativeTime: MissionControlData["formatRelativeTime"];
  onOpenTask: (taskId: string) => void;
}) {
  return (
    <article
      className={`mc-v2-brief-item ${itemTone(item)}`}
      onClick={() => { if (item.taskId) onOpenTask(item.taskId); }}
      style={item.taskId ? { cursor: "pointer" } : undefined}
    >
      <div className="mc-v2-brief-item-top">
        <span className="mc-v2-brief-kicker">{CATEGORY_LABELS[item.category]}</span>
        <span className="mc-v2-feed-time">{formatRelativeTime(item.timestamp)}</span>
      </div>
      <h3>{item.title}</h3>
      <p>{item.summary}</p>
      {(item.decision || item.nextStep) && (
        <div className="mc-v2-brief-disposition">
          {item.decision && <span>{item.decision}</span>}
          {item.nextStep && <strong>{item.nextStep}</strong>}
        </div>
      )}
    </article>
  );
}

function BriefSection({
  title,
  items,
  empty,
  formatRelativeTime,
  onOpenTask,
}: {
  title: string;
  items: MissionControlItem[];
  empty: string;
  formatRelativeTime: MissionControlData["formatRelativeTime"];
  onOpenTask: (taskId: string) => void;
}) {
  return (
    <section className="mc-v2-brief-section">
      <div className="mc-v2-brief-section-header">
        <h2>{title}</h2>
        <span>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="mc-v2-empty mc-v2-empty-compact">{empty}</div>
      ) : (
        <div className="mc-v2-brief-list">
          {items.map((item) => (
            <BriefItem
              key={item.id}
              item={item}
              formatRelativeTime={formatRelativeTime}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function MCOverviewTab({ data }: MCOverviewTabProps) {
  const {
    missionControlBrief,
    missionControlItems,
    activeAgentsCount,
    totalTasksInQueue,
    pendingMentionsCount,
    commandCenterReviewQueue,
    formatRelativeTime,
    setActiveTab,
    setDetailPanel,
    loadMissionControlIntelligence,
    selectedWorkspaceId,
  } = data;

  const brief = missionControlBrief;
  const attention = brief?.sections.find((section) => section.title === "Needs attention")?.items || [];
  const decisions = brief?.latestDecisions || [];
  const learnings = brief?.learningChanges || [];
  const awareness = brief?.awarenessClusters || [];
  const work = brief?.activeWork || [];
  const reviews = brief?.upcomingReviews || [];

  const openTask = (taskId: string) => setDetailPanel({ kind: "task", taskId });

  return (
    <div className="mc-v2-brief">
      <div className="mc-v2-brief-hero">
        <div>
          <h1>Command Brief</h1>
          <p>{brief ? `Updated ${formatRelativeTime(brief.generatedAt)}` : "Preparing grouped brief..."}</p>
        </div>
        <div className="mc-v2-brief-actions">
          <button className="mc-v2-icon-btn" onClick={() => void loadMissionControlIntelligence(selectedWorkspaceId)}>
            Refresh brief
          </button>
          <button className="mc-v2-icon-btn" onClick={() => setActiveTab("feed")}>
            Evidence Feed
          </button>
        </div>
      </div>

      <div className="mc-v2-brief-metrics">
        <button className="mc-v2-brief-metric attention" onClick={() => setActiveTab("feed")}>
          <strong>{brief?.attentionCount ?? 0}</strong>
          <span>need attention</span>
        </button>
        <button className="mc-v2-brief-metric" onClick={() => setActiveTab("board")}>
          <strong>{brief?.activeWorkCount || totalTasksInQueue}</strong>
          <span>active work</span>
        </button>
        <button className="mc-v2-brief-metric" onClick={() => setActiveTab("intelligence")}>
          <strong>{brief?.learningCount ?? 0}</strong>
          <span>learnings</span>
        </button>
        <button className="mc-v2-brief-metric" onClick={() => setActiveTab("intelligence")}>
          <strong>{brief?.awarenessCount ?? 0}</strong>
          <span>awareness</span>
        </button>
        <button className="mc-v2-brief-metric" onClick={() => setActiveTab("feed")}>
          <strong>{brief?.evidenceCount ?? 0}</strong>
          <span>evidence rows</span>
        </button>
      </div>

      <div className="mc-v2-brief-system-row">
        <span>{activeAgentsCount} active agents</span>
        <span>{pendingMentionsCount} pending mentions</span>
        <span>{commandCenterReviewQueue.length} output reviews</span>
        <span>{missionControlItems.length} grouped items</span>
      </div>

      <div className="mc-v2-brief-grid">
        <BriefSection
          title="Needs Attention"
          items={attention}
          empty="No action-needed items right now."
          formatRelativeTime={formatRelativeTime}
          onOpenTask={openTask}
        />
        <BriefSection
          title="Latest Decisions"
          items={decisions}
          empty="No recent decisions have been recorded."
          formatRelativeTime={formatRelativeTime}
          onOpenTask={openTask}
        />
        <BriefSection
          title="Learnings"
          items={learnings}
          empty="No new learnings yet."
          formatRelativeTime={formatRelativeTime}
          onOpenTask={openTask}
        />
        <BriefSection
          title="Awareness"
          items={awareness}
          empty="No grouped awareness signals yet."
          formatRelativeTime={formatRelativeTime}
          onOpenTask={openTask}
        />
        <BriefSection
          title="Active Work"
          items={work}
          empty="No active grouped work items."
          formatRelativeTime={formatRelativeTime}
          onOpenTask={openTask}
        />
        <BriefSection
          title="Upcoming Reviews"
          items={reviews}
          empty="No scheduled review notes yet."
          formatRelativeTime={formatRelativeTime}
          onOpenTask={openTask}
        />
      </div>
    </div>
  );
}
