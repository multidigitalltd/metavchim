"use client";

import { TasksBoard } from "./tasks-board";

/**
 * מסך המשימות. כל התוכן ב-`TasksBoard`, שמשמש גם את לשונית המשימות
 * של היומן — שני מסכים שמציגים משימות היו שתי רשימות שמתחילות
 * להיפרד.
 */
export default function TasksPage() {
  return (
    <div className="py-6">
      <TasksBoard />
    </div>
  );
}
