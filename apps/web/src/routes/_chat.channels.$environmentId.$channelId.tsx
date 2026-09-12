import { createFileRoute } from "@tanstack/react-router";
import type { ChannelId, EnvironmentId } from "@t3tools/contracts";

import { ChannelView } from "../components/ChannelView";
import { SidebarInset } from "~/components/ui/sidebar";

function ChannelRouteView() {
  // Cast rather than decode, as `resolveThreadRouteRef` does for threads: a
  // param that is not a real channel id simply matches nothing in the shell,
  // and `ChannelView` already renders that. Constructing through the schema
  // would THROW on a hand-typed URL — a blank screen where the answer is "this
  // channel isn't available".
  //
  // Whether the channel exists and whether this member is in it are the same
  // question here, because the server only sends the channels the member is in.
  const params = Route.useParams();
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ChannelView
        environmentId={params.environmentId as EnvironmentId}
        channelId={params.channelId as ChannelId}
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/channels/$environmentId/$channelId")({
  component: ChannelRouteView,
});
