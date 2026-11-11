// Generated module. Do not edit.
#include "estatic_common.hpp"

struct Progress;

static Progress progress;

void configureProgress(bool verbose, bool animate) {
    progress.configure(verbose, animate);
}

bool progressInteractive() {
    return progress.animated;
}

void progressStart(std::string label) {
    progress.start(label);
}

void progressDetail(std::string text) {
    progress.update(text);
}

void progressTick() {
    progress.render();
}

void progressFinish(bool ok) {
    progress.finish(ok);
}

void progressSummary(std::string cpp, std::string binary) {
    progress.summary(cpp, binary);
}

void ets_init_bootstrap_progress_progress_6e8dd651() {
    progress = Progress{}.constructor();
}
