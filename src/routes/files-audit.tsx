import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { LocalOnly } from "@/components/LocalOnly";
import { FilesPage } from "./_authenticated/files";

export const Route = createFileRoute("/files-audit")({
  head: () => ({ meta: [{ title: "Files audit" }] }),
  component: () => (
    <Page title="Files" footer="audit">
      <LocalOnly>
        <FilesPage />
      </LocalOnly>
    </Page>
  ),
});
