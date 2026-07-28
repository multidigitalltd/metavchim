-- סיסמה זמנית שחובה להחליף בכניסה ראשונה (ביקורת Codex, PR #5)
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
