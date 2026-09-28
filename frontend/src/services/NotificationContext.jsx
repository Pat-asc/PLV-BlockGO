import React, { createContext, useState, useCallback, useContext } from 'react';

const NotificationContext = createContext({
    addNotification: (message, type) => console.warn("NotificationProvider missing! Message:", message)
});

let externalNotificationHandler = null;

const inferNotificationType = (message) => {
    const value = String(message || '').toLowerCase();
    if (/fail|error|invalid|unable|cannot|could not|not found|required|please|denied|rejected|missing|no .*available/.test(value)) return 'error';
    if (/success|saved|created|submitted|approved|assigned|uploaded|imported|exported|forwarded|removed|revoked|reset|finalized|promoted|updated|distributed/.test(value)) return 'success';
    return 'notice';
};

export const showSystemNotification = (message, type) => {
    const resolvedType = type || inferNotificationType(message);
    if (externalNotificationHandler) externalNotificationHandler(String(message || ''), resolvedType);
    else console.warn('NotificationProvider missing! Message:', message);
};

export const useNotification = () => useContext(NotificationContext);

const notificationMeta = {
    success: { title: 'Success', accent: 'bg-emerald-500', icon: '✓' },
    error: { title: 'Action needed', accent: 'bg-red-500', icon: '!' },
    notice: { title: 'Notification', accent: 'bg-[#003366]', icon: 'i' },
};

const Notification = ({ message, type, createdAt, onDismiss }) => {
    const baseClasses = "notification-enter relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl border bg-white p-4 pl-5 shadow-xl";
    const typeClasses = {
        success: "border-emerald-200 text-slate-800",
        error: "border-red-200 text-slate-800",
        notice: "border-blue-200 text-slate-800",
    };
    const meta = notificationMeta[type] || notificationMeta.notice;

    return (
        <section role={type === 'error' ? 'alert' : 'status'} aria-live={type === 'error' ? 'assertive' : 'polite'} className={`${baseClasses} ${typeClasses[type] || typeClasses.success}`}>
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${meta.accent}`} />
            <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${meta.accent}`}>{meta.icon}</span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-[#003366]">{meta.title}</span><span className="mt-0.5 block text-sm leading-5 text-slate-700">{message}</span><time className="mt-1.5 block text-xs text-slate-400" dateTime={new Date(createdAt).toISOString()}>Just now</time></span>
            <button type="button" onClick={onDismiss} aria-label="Close notification" className="-mr-1 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition hover:bg-black/10 focus:outline-none focus:ring-2 focus:ring-current">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
        </section>
    );
};

export const NotificationProvider = ({ children }) => {
    const [notifications, setNotifications] = useState([]);

    const addNotification = useCallback((message, type = 'success') => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setNotifications((prev) => [...prev, { id, message, type, createdAt: Date.now() }].slice(-4));
        setTimeout(() => {
            setNotifications((prev) => prev.filter((notification) => notification.id !== id));
        }, type === 'notice' ? 10000 : 5000);
    }, []);

    React.useEffect(() => {
        externalNotificationHandler = addNotification;
        return () => {
            if (externalNotificationHandler === addNotification) externalNotificationHandler = null;
        };
    }, [addNotification]);

    const dismissNotification = (id) => {
        setNotifications((prev) => prev.filter((notification) => notification.id !== id));
    };

    return (
        <NotificationContext.Provider value={{ addNotification }}>
            {children}
            {notifications.length > 0 && (
                <div className="fixed right-5 top-5 z-[2000] flex max-w-[calc(100vw-2.5rem)] flex-col gap-3" aria-label="Notifications">
                    {notifications.map((notification) => (
                        <Notification
                            key={notification.id}
                            message={notification.message}
                            type={notification.type}
                            createdAt={notification.createdAt}
                            onDismiss={() => dismissNotification(notification.id)}
                        />
                    ))}
                </div>
            )}
        </NotificationContext.Provider>
    );
};
