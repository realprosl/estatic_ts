// Generated module. Do not edit.
#include "estatic_common.hpp"

std::vector<double> irLeaseUnion(std::vector<double> left, std::vector<double> right) {
    for (const auto& value : right) {
        if ((!ets_includes_vec<double>(left, value))) {
            ets_push_vec<double>(left, value);
        }
    }
    return left;
}

bool irLeaseEqual(std::vector<double> left, std::vector<double> right) {
    if ((left.size() != right.size())) {
        return false;
    }
    for (const auto& value : left) {
        if ((!ets_includes_vec<double>(right, value))) {
            return false;
        }
    }
    return true;
}

std::vector<double> irLeaseRemove(std::vector<double> values, double value) {
    std::vector<double> result = std::vector<double>();
    for (const auto& item : values) {
        if ((item != value)) {
            ets_push_vec<double>(result, item);
        }
    }
    return result;
}

IrProject finishBorrows(IrProject project) {
    for (double f = 0.0; (f < project.functions.size()); (f = (f + 1.0))) {
        for (double b = 0.0; (b < project.functions[static_cast<std::size_t>(f)].blocks.size()); (b = (b + 1.0))) {
            for (double at = 0.0; (at < project.functions[static_cast<std::size_t>(f)].blocks[static_cast<std::size_t>(b)].instructions.size()); (at = (at + 1.0))) {
                const auto i = project.functions[static_cast<std::size_t>(f)].blocks[static_cast<std::size_t>(b)].instructions[static_cast<std::size_t>(at)];
                if (((i.op == std::string("borrow")) || (i.op == std::string("address")))) {
                    const double lease = project.functions[static_cast<std::size_t>(f)].leases.size();
                    ets_push_vec<IrLease>(project.functions[static_cast<std::size_t>(f)].leases, IrLease{}.constructor(i.place, i.result, (((i.op == std::string("borrow")) && (i.text == std::string("constRef"))) ? std::string("constRef") : std::string("ref"))));
                    (project.functions[static_cast<std::size_t>(f)].blocks[static_cast<std::size_t>(b)].instructions[static_cast<std::size_t>(at)].lease = lease);
                }
            }
        }
        auto analysis = IrBorrowAnalysis{}.constructor(project.functions[static_cast<std::size_t>(f)], project.types);
        analysis.propagate();
        analysis.liveness();
        const double count = project.functions[static_cast<std::size_t>(f)].blocks.size();
        for (double b = 0.0; (b < count); (b = (b + 1.0))) {
            const auto original = project.functions[static_cast<std::size_t>(f)].blocks[static_cast<std::size_t>(b)];
            std::vector<IrLeaseSet> after = std::vector<IrLeaseSet>();
            for (const auto& i : original.instructions) {
                ets_push_vec<IrLeaseSet>(after, IrLeaseSet{}.constructor());
            }
            std::vector<double> live = analysis.liveOut[static_cast<std::size_t>(b)].values;
            if ((original.value >= 0.0)) {
                (live = irLeaseUnion(live, analysis.values[static_cast<std::size_t>(original.value)].values));
            }
            for (double at = (original.instructions.size() - 1.0); (at >= 0.0); (at = (at - 1.0))) {
                (after[static_cast<std::size_t>(at)].values = live);
                const auto i = original.instructions[static_cast<std::size_t>(at)];
                if (((i.lease >= 0.0) && ets_includes_vec<std::string>(std::vector<std::string>{std::string("borrow"), std::string("address")}, i.op))) {
                    (live = irLeaseRemove(live, i.lease));
                }
                (live = irLeaseUnion(live, analysis.uses(i)));
            }
            std::vector<IrInstruction> instructions = std::vector<IrInstruction>();
            for (double at = 0.0; (at < original.instructions.size()); (at = (at + 1.0))) {
                const auto i = original.instructions[static_cast<std::size_t>(at)];
                ets_push_vec<IrInstruction>(instructions, i);
                std::vector<double> used = analysis.uses(i);
                if ((i.lease >= 0.0)) {
                    (used = irLeaseUnion(used, std::vector<double>{i.lease}));
                }
                for (const auto& lease : used) {
                    if ((!ets_includes_vec<double>(after[static_cast<std::size_t>(at)].values, lease))) {
                        auto end = IrInstruction{}.constructor(std::string("endBorrow"), (-1.0), (-1.0), i.source);
                        (end.lease = lease);
                        ets_push_vec<IrInstruction>(instructions, end);
                    }
                }
            }
            (project.functions[static_cast<std::size_t>(f)].blocks[static_cast<std::size_t>(b)].instructions = instructions);
            for (double edge = 0.0; (edge < original.targets.size()); (edge = (edge + 1.0))) {
                const double target = original.targets[static_cast<std::size_t>(edge)];
                std::vector<double> ends = std::vector<double>();
                for (const auto& lease : analysis.liveOut[static_cast<std::size_t>(b)].values) {
                    if ((!ets_includes_vec<double>(analysis.liveIn[static_cast<std::size_t>(target)].values, lease))) {
                        ets_push_vec<double>(ends, lease);
                    }
                }
                if ((ends.size() > 0.0)) {
                    auto block = IrBlock{}.constructor(original.source);
                    for (const auto& lease : ends) {
                        auto end = IrInstruction{}.constructor(std::string("endBorrow"), (-1.0), (-1.0), original.source);
                        (end.lease = lease);
                        ets_push_vec<IrInstruction>(block.instructions, end);
                    }
                    (block.terminator = std::string("jump"));
                    (block.targets = std::vector<double>{target});
                    const double ets_local_index = project.functions[static_cast<std::size_t>(f)].blocks.size();
                    ets_push_vec<IrBlock>(project.functions[static_cast<std::size_t>(f)].blocks, block);
                    ets_set_vec<double>(project.functions[static_cast<std::size_t>(f)].blocks[static_cast<std::size_t>(b)].targets, edge, ets_local_index);
                }
            }
        }
    }
    return project;
}

void ets_init_bootstrap_ir_borrows_34b30c88() {
}
