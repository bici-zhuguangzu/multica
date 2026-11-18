/**
 * Create an Issue in either a lightweight agent-dispatch mode or the
 * original full Issue form. Both modes use the same server createIssue API.
 * "Dispatch" means issue creation + assignment; execution status comes
 * exclusively from the server and the Issue timeline.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { canAssignAgentToIssue } from "@multica/core/permissions/rules";
import type { Agent } from "@multica/core/types";
import { SubmitIssueButton } from "@/components/issue/submit-issue-button";
import { CreateFormAttributeRow } from "@/components/issue/create-form-attribute-row";
import { MentionSuggestionBar } from "@/components/issue/mention-suggestion-bar";
import { DescriptionField } from "@/components/issue/description-field";
import { AgentPickerSheet } from "@/components/chat/agent-picker-sheet";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Text } from "@/components/ui/text";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { useCreateIssue } from "@/data/mutations/issues";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useMentionInput } from "@/lib/use-mention-input";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { useT } from "@/lib/i18n";

type CreateMode = "quick" | "full";

/** Deterministic local title, no model call and no loss of original instruction. */
function titleFromInstruction(instruction: string): string {
  const firstLine = instruction.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return firstLine.length > 72 ? firstLine.slice(0, 72).trimEnd() : firstLine;
}

export default function NewIssueModal() {
  const { t } = useT("issues");
  const [mode, setMode] = useState<CreateMode>("quick");
  const [title, setTitle] = useState("");
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const description = useMentionInput();

  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const role = members.find((m) => m.user_id === userId)?.role ?? null;
  const allowedAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          !agent.archived_at &&
          canAssignAgentToIssue(agent, { userId, role }).allowed,
      ),
    [agents, userId, role],
  );

  const status = useNewIssueDraftStore((s) => s.status);
  const priority = useNewIssueDraftStore((s) => s.priority);
  const assignee = useNewIssueDraftStore((s) => s.assignee);
  const setAssignee = useNewIssueDraftStore((s) => s.setAssignee);
  const dueDate = useNewIssueDraftStore((s) => s.dueDate);
  const project = useNewIssueDraftStore((s) => s.project);
  const resetDraft = useNewIssueDraftStore((s) => s.reset);

  useEffect(() => {
    resetDraft();
    return () => resetDraft();
  }, [resetDraft]);

  const selectedAgent: Agent | null =
    assignee?.type === "agent"
      ? allowedAgents.find((a) => a.id === assignee.id) ?? null
      : null;
  const createIssue = useCreateIssue();
  const isSubmitting = createIssue.isPending;
  const instruction = description.serialize().trim();
  const quickReady =
    !!selectedAgent &&
    isAgentRuntimeBound(selectedAgent) &&
    instruction.length > 0;
  const canSubmit = !isSubmitting && (mode === "quick" ? quickReady : title.trim().length > 0);

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    const quick = mode === "quick";
    const finalTitle = quick ? titleFromInstruction(instruction) : title.trim();
    if (!finalTitle) return;

    try {
      const issue = await createIssue.mutateAsync({
        title: finalTitle,
        description: instruction || undefined,
        status: quick ? "todo" : status,
        priority: quick ? "none" : priority,
        ...(quick
          ? { assignee_type: "agent" as const, assignee_id: selectedAgent!.id }
          : assignee
            ? { assignee_type: assignee.type, assignee_id: assignee.id }
            : {}),
        ...(!quick && dueDate ? { due_date: dueDate } : {}),
        ...(project ? { project_id: project.id } : {}),
      });
      // Show the server-authoritative status, not a fabricated "running" state.
      if (wsSlug && issue?.id) {
        router.replace({
          pathname: "/[workspace]/issue/[id]",
          params: { workspace: wsSlug, id: issue.id },
        });
      } else {
        router.back();
      }
    } catch (err) {
      Alert.alert(
        t("errors.create_failed"),
        err instanceof Error ? err.message : t("common:states.error"),
      );
    }
  }, [
    canSubmit, mode, instruction, title, status, priority, assignee,
    selectedAgent, dueDate, project, createIssue, wsSlug, t,
  ]);

  const headerRight = useCallback(
    () => mode === "full" ? (
      <SubmitIssueButton disabled={!canSubmit} loading={isSubmitting} onPress={onSubmit} />
    ) : null,
    [mode, canSubmit, isSubmitting, onSubmit],
  );

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-4 pb-6 gap-4"
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-row rounded-xl bg-secondary p-1">
            {(["quick", "full"] as const).map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === item }}
                onPress={() => setMode(item)}
                disabled={isSubmitting}
                className={`flex-1 items-center rounded-lg px-3 py-2.5 ${mode === item ? "bg-background" : ""}`}
              >
                <Text className={`text-sm font-semibold ${mode === item ? "text-foreground" : "text-muted-foreground"}`}>
                  {item === "quick" ? "快速下发" : "完整 Issue"}
                </Text>
              </Pressable>
            ))}
          </View>

          {mode === "quick" ? (
            <>
              <View className="gap-2">
                <Text className="text-sm font-semibold">执行智能体</Text>
                <Pressable
                  onPress={() => setAgentPickerOpen(true)}
                  disabled={isSubmitting}
                  className="flex-row items-center gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3"
                  accessibilityRole="button"
                  accessibilityLabel="选择执行智能体"
                >
                  {selectedAgent ? (
                    <ActorAvatar type="agent" id={selectedAgent.id} size={36} showPresence />
                  ) : (
                    <View className="size-9 items-center justify-center rounded-full bg-secondary">
                      <Text className="text-xl text-muted-foreground">◎</Text>
                    </View>
                  )}
                  <View className="flex-1">
                    <Text className="font-semibold">
                      {selectedAgent?.name ?? "选择一个智能体"}
                    </Text>
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {selectedAgent?.description ?? "仅显示你有权限分配的智能体"}
                    </Text>
                  </View>
                  <Text className="text-muted-foreground">›</Text>
                </Pressable>
                {allowedAgents.length === 0 ? (
                  <Text className="text-xs text-muted-foreground">
                    当前没有可分配的智能体，请检查权限或智能体设置。
                  </Text>
                ) : null}
              </View>

              <View className="gap-2">
                <Text className="text-sm font-semibold">任务指令</Text>
                <DescriptionField
                  description={description}
                  disabled={isSubmitting}
                  placeholder="描述需要智能体完成的目标、背景和验收标准…"
                />
                <Text className="text-xs text-muted-foreground">
                  原始指令将完整保存在 Issue 描述中，标题自动提取首行。
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  if (wsSlug) {
                    router.push({
                      pathname: "/[workspace]/new-issue-picker/project",
                      params: { workspace: wsSlug },
                    });
                  }
                }}
                className="rounded-xl border border-border px-4 py-3"
                disabled={isSubmitting}
              >
                <Text className="text-sm">
                  {project ? `关联项目：${project.title}` : "关联项目（可选）  ›"}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={t("new.title_placeholder")}
                placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
                className="text-2xl font-semibold text-foreground py-2"
                returnKeyType="next"
                editable={!isSubmitting}
              />
              <DescriptionField description={description} disabled={isSubmitting} />
              <CreateFormAttributeRow />
            </>
          )}
        </ScrollView>

        <MentionSuggestionBar {...description.suggestionBar} />
        {mode === "quick" ? (
          <View className="border-t border-border px-4 py-3 pb-5 bg-background">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
              disabled={!canSubmit}
              onPress={onSubmit}
              className={`items-center rounded-xl py-3.5 ${canSubmit ? "bg-brand" : "bg-secondary"}`}
            >
              <Text className={`font-semibold ${canSubmit ? "text-white" : "text-muted-foreground"}`}>
                {isSubmitting ? "正在创建…" : "下发任务"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
      <AgentPickerSheet
        visible={agentPickerOpen}
        agents={allowedAgents}
        currentAgentId={selectedAgent?.id ?? null}
        onPick={(agent) => setAssignee({ type: "agent", id: agent.id })}
        onClose={() => setAgentPickerOpen(false)}
      />
    </>
  );
}
