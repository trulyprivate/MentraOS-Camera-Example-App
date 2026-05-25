import VoiceAgentStudio from "./components/VoiceAgentStudio";

interface VoiceAgentPageProps {
  userId: string;
}

export default function VoiceAgentPage({ userId }: VoiceAgentPageProps) {
  return <VoiceAgentStudio userId={userId} />;
}
