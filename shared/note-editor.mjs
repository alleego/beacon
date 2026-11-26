import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { safeLink } from "./domain.mjs";

export const noteExtensions = () => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      isAllowedUri: safeLink,
    },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
];
