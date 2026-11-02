import { Container, Text, type VanillaText } from "@react-three/uikit";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { RenderReporter } from "../session/display-session.ts";
import type { PanelItem } from "../model/display-state.ts";
import { panelTitle, renderableText } from "../model/glyph-fallback.ts";
import { FONT_FAMILIES, FONT_FAMILY } from "./fonts.ts";
import { placement } from "./placement.ts";
import { FailureBoundary } from "./RenderBoundary.tsx";

const TITLE_LIMIT = 40;

function PanelText({ panel, reporter }: { panel: PanelItem; reporter: RenderReporter }) {
  const title = useRef<VanillaText>(null);
  const body = useRef<VanillaText>(null);
  useEffect(() => {
    const texts = [title.current, body.current].filter((text): text is VanillaText => text !== null);
    if (texts.length !== 2) {
      reporter.failed(panel.key);
      return;
    }
    // uikit loads fonts outside React Suspense; the text is only drawable once both have one.
    let reported = false;
    const check = () => {
      if (reported || !texts.every((text) => text.fontSignal.value)) return;
      reported = true;
      reporter.ready(panel.key);
    };
    const unsubscribe = texts.map((text) => text.fontSignal.subscribe(check));
    return () => unsubscribe.forEach((stop) => stop());
  }, [panel.key, reporter]);
  return (
    <Container
      width={140}
      height={70}
      padding={8}
      flexDirection="column"
      fontFamilies={FONT_FAMILIES}
      fontFamily={FONT_FAMILY}
      backgroundColor="#081020"
      borderColor="#7fd0ff"
      borderWidth={1}
    >
      <Text ref={title} fontSize={8} color="#d7f3ff">
        {panelTitle(panel.title, TITLE_LIMIT)}
      </Text>
      <Text ref={body} fontSize={5} color="#d7f3ff">
        {renderableText(panel.text)}
      </Text>
    </Container>
  );
}

export function PanelCard({
  panel,
  reporter,
  onSelect,
}: {
  panel: PanelItem;
  reporter: RenderReporter;
  onSelect: (targetId: string) => void;
}) {
  const pose = placement(panel.anchor, panel.pose);
  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(panel.panelId);
  };
  return (
    <group position={pose.position} rotation={pose.rotation} scale={pose.scale} onClick={select}>
      <mesh>
        <planeGeometry args={[1.4, 0.7]} />
        <meshBasicMaterial color="#081020" transparent opacity={0.92} />
      </mesh>
      <FailureBoundary resetKey={panel.key} onFailed={() => reporter.failed(panel.key)}>
        <PanelText panel={panel} reporter={reporter} />
      </FailureBoundary>
    </group>
  );
}
