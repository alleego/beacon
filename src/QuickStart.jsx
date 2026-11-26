import React from "react";
import {
  UserRound,
  Server,
  MessageSquare,
  NotebookPen,
  Package,
  ArrowRight,
  Check,
  RotateCcw,
} from "lucide-react";
const steps = [
  {
    title: "Your profile",
    Icon: UserRound,
    action: "Edit profile",
    target: "Profile",
  },
  {
    title: "Your Claude connection",
    Icon: Server,
    action: "Open connection settings",
    target: "Connection",
  },
  {
    title: "Chats and projects",
    Icon: MessageSquare,
    action: "Open chats",
    target: "chat",
  },
  { title: "Notes", Icon: NotebookPen, action: "Open Notes", target: "notes" },
  {
    title: "Optional modules",
    Icon: Package,
    action: "Open module settings",
    target: "Modules",
  },
];
export default function QuickStart({
  settings,
  onSave,
  onClose,
  onOpen,
  Modal,
}) {
  const index = settings.tutorialStep,
    step = steps[index],
    Icon = step.Icon;
  const finish = (status) => {
    onSave({ ...settings, tutorialStatus: status });
    onClose();
  };
  return (
    <Modal
      title="Quick start"
      onClose={() => finish("dismissed")}
      className="quick-start-modal"
    >
      <div className="modal-body">
        <ol className="tour-steps">
          {steps.map((s, i) => (
            <li key={s.title}>
              <button
                aria-current={i === index ? "step" : undefined}
                onClick={() =>
                  onSave({
                    ...settings,
                    tutorialStep: i,
                    tutorialStatus: "active",
                  })
                }
              >
                <span>{i + 1}</span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
        <div className="tour-current">
          <Icon size={28} />
          <h3>{step.title}</h3>
          <button
            onClick={() => {
              onSave({ ...settings, tutorialStatus: "active" });
              onOpen(step.target);
            }}
          >
            {step.action}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <footer>
        <button onClick={() => finish("dismissed")}>Skip</button>
        <button
          disabled={index === 0}
          onClick={() =>
            onSave({
              ...settings,
              tutorialStep: index - 1,
              tutorialStatus: "active",
            })
          }
        >
          Back
        </button>
        <button
          className="primary"
          onClick={() =>
            index === steps.length - 1
              ? finish("complete")
              : onSave({
                  ...settings,
                  tutorialStep: index + 1,
                  tutorialStatus: "active",
                })
          }
        >
          {index === steps.length - 1 ? (
            <>
              Done
              <Check size={16} />
            </>
          ) : (
            <>
              Next
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </footer>
    </Modal>
  );
}
export function QuickStartSettings({ onReplay, onReset }) {
  return (
    <div className="actions">
      <button onClick={onReplay}>Replay quick start</button>
      <button onClick={onReset}>
        <RotateCcw size={16} />
        Reset tutorial progress
      </button>
    </div>
  );
}
