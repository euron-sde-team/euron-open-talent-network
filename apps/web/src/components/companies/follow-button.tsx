"use client";

import { Check, Plus } from "lucide-react";
import { Button, type ButtonProps } from "@open-talent/ui";

/** Follow / Following. Hovering "Following" offers the way back out. */
export function FollowButton({
  following,
  onToggle,
  pending,
  size = "sm",
  block,
  name,
}: {
  following: boolean;
  onToggle: () => void;
  pending?: boolean;
  size?: ButtonProps["size"];
  block?: boolean;
  name: string;
}) {
  return (
    <Button
      variant={following ? "outline" : "soft"}
      size={size}
      block={block}
      onClick={onToggle}
      disabled={pending}
      aria-pressed={following}
      aria-label={following ? `Unfollow ${name}` : `Follow ${name}`}
      data-testid="company-follow"
      data-state-follow={following ? "on" : "off"}
      className="group/follow"
    >
      {following ? (
        <>
          <Check aria-hidden />
          <span className="group-hover/follow:hidden">Following</span>
          <span className="hidden group-hover/follow:inline">Unfollow</span>
        </>
      ) : (
        <>
          <Plus aria-hidden />
          Follow
        </>
      )}
    </Button>
  );
}
