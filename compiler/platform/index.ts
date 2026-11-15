// API pública de compiler/platform/ (#177): lo único que pueden importar las demás capas.
// Generado a partir de los imports reales; añade aquí lo que otra capa necesite.

export { analysisUsage, compilerHome, currentDirectory, directories, environment, environmentDefined, executable, exists, files, finishWorker, forkWorker, hostError, launch, now, objectKeys, pause, poll, processors, readText, remove, rename, setEnvironment, stdinText, temporaryDirectory, terminal, terminate, waitWorker, writeText } from "./host";
export { canonicalFile, contentHash, fileMetadata, publishRecord, readSnapshot, syntaxIdentity } from "./platform";
export { configureProgress, progressDetail, progressFinish, progressInteractive, progressStart, progressSummary, progressTick } from "./progress";
