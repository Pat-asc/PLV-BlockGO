import React from 'react';
import Modal from '../../services/Modal';

const GraduatingSectionModal = ({
  section,
  statuses,
  buildStudentName,
  onUpdateStudent,
  onClose,
}) => (
  <Modal
    isOpen={Boolean(section)}
    onClose={onClose}
    title={section ? `${section.sectionName || section.sourceSection || section.targetSection || 'Section'} Students` : 'Section Students'}
    panelClassName="max-h-[calc(100dvh-1rem)] max-w-6xl overflow-y-auto"
  >
    <div className="max-h-[70vh] overflow-auto" data-testid="graduating-section-modal-roster">
      <table className="min-w-full">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#003366] text-white">
            <th className="px-4 py-3 text-left text-sm">Student</th>
            <th className="px-4 py-3 text-left text-sm">Origin</th>
            <th className="px-4 py-3 text-left text-sm">Status</th>
            <th className="px-4 py-3 text-left text-sm">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {(section?.students || []).map((student) => (
            <tr
              key={`${student.studentId}-${student.targetSchoolYear}`}
              className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
            >
              <td className="px-4 py-3">
                <p className="font-semibold text-slate-800 dark:text-slate-100">{student.studentId}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{buildStudentName(student)}</p>
              </td>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                Batch {student.originBatchYear || student.sourceSchoolYear}
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {student.originYearLevel || student.yearLevel}
                </span>
              </td>
              <td className="px-4 py-3">
                <select
                  value={student.status || 'Incomplete'}
                  onChange={(event) => onUpdateStudent(student.studentId, {
                    status: event.target.value,
                    reviewedAt: new Date().toISOString(),
                  })}
                  className="min-w-48 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003366] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </td>
              <td className="px-4 py-3">
                <input
                  type="text"
                  value={student.remarks || ''}
                  onChange={(event) => onUpdateStudent(student.studentId, { remarks: event.target.value })}
                  placeholder="Review note"
                  className="min-w-64 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003366] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Modal>
);

export default GraduatingSectionModal;
