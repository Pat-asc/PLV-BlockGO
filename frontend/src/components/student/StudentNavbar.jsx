import plvlogo from "../../assets/plvlogo.png";
import SettingsMenu from "../shared/SettingsMenu";

const StudentNavbar = ({ studentData, onLogout, renderSettings }) => {
  const displayName = String(studentData?.name || '').trim().split(/\s+/)[0] || 'PLVian';

  return (
    <header
      className="w-full border-b-2 border-yellow-400 bg-[#001b55] shadow-sm"
      style={{ backgroundImage: "linear-gradient(118deg, transparent 0 48%, rgba(10,48,122,.72) 48.2% 62%, transparent 62.2%), linear-gradient(142deg, transparent 0 68%, rgba(0,43,112,.85) 68.2% 83%, transparent 83.2%), linear-gradient(105deg, #00113f 0%, #002469 54%, #001748 100%)" }}
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">
            <img
              src={plvlogo}
              alt="PLV Logo"
              className="h-10 w-10 object-contain"
            />
          </div>

          <div className="leading-tight">
              <p className="text-xs font-medium uppercase tracking-wide text-white/70 sm:text-sm sm:normal-case sm:tracking-normal">Student Portal</p>
              <h1 className="truncate text-base font-bold text-white sm:text-xl">Welcome, {displayName}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <SettingsMenu title="Student Settings" description="Manage your account and portal preferences.">
            {renderSettings}
          </SettingsMenu>
          <button
            type="button"
            onClick={onLogout}
            className="h-10 rounded-lg border border-yellow-400 bg-transparent px-3 text-sm font-semibold text-yellow-400 transition hover:bg-yellow-400 hover:text-[#003366] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#001b55] sm:px-4"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
};

export default StudentNavbar;
