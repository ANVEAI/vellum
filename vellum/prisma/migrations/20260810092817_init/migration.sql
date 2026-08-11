-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "prompt" TEXT,
    "outline" TEXT,
    "researchContext" TEXT,
    "slides" TEXT NOT NULL DEFAULT '[]',
    "themeName" TEXT NOT NULL DEFAULT 'mystique',
    "customThemeId" TEXT,
    "genParams" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "errorMessage" TEXT,
    "rawXml" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_customThemeId_fkey" FOREIGN KEY ("customThemeId") REFERENCES "CustomTheme" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomTheme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GeneratedImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT,
    "slideId" TEXT,
    "nodeId" TEXT,
    "prompt" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "path" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GeneratedImage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "GeneratedImage_documentId_status_idx" ON "GeneratedImage"("documentId", "status");
