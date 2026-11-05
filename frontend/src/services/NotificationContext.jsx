import React, { createContext, useState, useCallback, useContext, useRef } from 'react';

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

export const showSystemNotification = (message, type, options) => {
    const resolvedType = type || inferNotificationType(message);
    if (externalNotificationHandler) externalNotificationHandler(String(message || ''), resolvedType, options);
    else console.warn('NotificationProvider missing! Message:', message);
};

export const useNotification = () => useContext(NotificationContext);

const notificationMeta = {
    success: { title: 'Success', accent: 'bg-emerald-500', icon: '✓' },
    error: { title: 'Action needed', accent: 'bg-red-500', icon: '!' },
    warning: { title: 'Warning', accent: 'bg-amber-500', icon: '!' },
    info: { title: 'Information', accent: 'bg-[#003366]', icon: 'i' },
    notice: { title: 'Notification', accent: 'bg-[#003366]', icon: 'i' },
};

const Notification = ({ message, type, title, createdAt, exiting, onActivate, onDismiss }) => {
    const baseClasses = `${exiting ? 'notification-exit' : 'notification-enter'} pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl border bg-white p-4 pl-5 shadow-xl`;
    const typeClasses = {
        success: "border-emerald-200 text-slate-800",
        error: "border-red-200 text-slate-800",
        warning: "border-amber-200 text-slate-800",
        info: "border-blue-200 text-slate-800",
        notice: "border-blue-200 text-slate-800",
    };
    const meta = notificationMeta[type] || notificationMeta.notice;
    const body = <><span className="block text-sm font-bold text-[#003366]">{title || meta.title}</span><span className="mt-0.5 block whitespace-pre-line break-words text-sm leading-5 text-slate-700">{message}</span><time className="mt-1.5 block text-xs text-slate-400" dateTime={new Date(createdAt).toISOString()}>Just now</time></>;

    return (
        <section data-system-theme-surface="notification" role={type === 'error' ? 'alert' : 'status'} aria-live={type === 'error' ? 'assertive' : 'polite'} className={`${baseClasses} ${typeClasses[type] || typeClasses.notice}`}>
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${meta.accent}`} />
            <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${meta.accent}`}>{meta.icon}</span>
            {onActivate ? (
                <button type="button" onClick={onActivate} className="min-w-0 flex-1 rounded-md text-left focus:outline-none focus:ring-2 focus:ring-[#003366] focus:ring-offset-2" aria-label={`${title || meta.title}: ${message}`}>{body}</button>
            ) : <span className="min-w-0 flex-1">{body}</span>}
            <button type="button" onClick={onDismiss} aria-label="Close notification" className="-mr-1 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition hover:bg-black/10 focus:outline-none focus:ring-2 focus:ring-current">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
        </section>
    );
};

export const NotificationProvider = ({ children }) => {
    const [notifications, setNotifications] = useState([]);
    const nextIdRef = useRef(0);
    const seenEventKeysRef = useRef(new Set());
    const seenEventOrderRef = useRef([]);
    const timersRef = useRef(new Map());

    const removeNotification = useCallback((id) => {
        window.clearTimeout(timersRef.current.get(id));
        timersRef.current.delete(id);
        setNotifications((prev) => prev.filter((notification) => notification.id !== id));
    }, []);

    const dismissNotification = useCallback((id) => {
        window.clearTimeout(timersRef.current.get(id));
        setNotifications((prev) => prev.map((notification) => notification.id === id ? { ...notification, exiting: true } : notification));
        timersRef.current.set(id, window.setTimeout(() => removeNotification(id), 180));
    }, [removeNotification]);

    const addNotification = useCallback((message, type = 'success', options = {}) => {
        const resolvedOptions = typeof options === 'string' ? { eventKey: options } : options || {};
        const eventKey = resolvedOptions.eventKey;
        if (eventKey && seenEventKeysRef.current.has(eventKey)) return;
        if (eventKey) {
            seenEventKeysRef.current.add(eventKey);
            seenEventOrderRef.current.push(eventKey);
            if (seenEventOrderRef.current.length > 500) {
                seenEventKeysRef.current.delete(seenEventOrderRef.current.shift());
            }
        }
        nextIdRef.current += 1;
        const id = `notification-${nextIdRef.current}`;
        setNotifications((prev) => {
            const next = [...prev, { id, message: String(message || ''), type, title: resolvedOptions.title, onClick: resolvedOptions.onClick, duration: resolvedOptions.duration, createdAt: Date.now(), exiting: false }];
            if (next.length <= 20) return next;
            const disposableIndex = next.findIndex((notification) => notification.type !== 'error');
            next.splice(disposableIndex >= 0 ? disposableIndex : 0, 1);
            return next;
        });
    }, []);

    const visibleNotifications = notifications.slice(0, 4);

    React.useEffect(() => {
        visibleNotifications.forEach((notification) => {
            if (notification.exiting || timersRef.current.has(notification.id)) return;
            const defaultDuration = notification.type === 'error' ? 9000 : notification.type === 'warning' ? 7000 : notification.type === 'success' ? 5000 : 8000;
            timersRef.current.set(notification.id, window.setTimeout(() => dismissNotification(notification.id), notification.duration ?? defaultDuration));
        });
    }, [dismissNotification, visibleNotifications]);

    React.useEffect(() => {
        const timers = timersRef.current;
        externalNotificationHandler = addNotification;
        return () => {
            if (externalNotificationHandler === addNotification) externalNotificationHandler = null;
            timers.forEach((timer) => window.clearTimeout(timer));
            timers.clear();
        };
    }, [addNotification]);

    return (
        <NotificationContext.Provider value={{ addNotification }}>
            {children}
            {notifications.length > 0 && (
                <div data-testid="notification-stack" className="pointer-events-none fixed left-3 right-3 top-16 z-[2000] flex flex-col gap-3 sm:left-auto sm:right-5 sm:w-96" aria-label="Notifications">
                    {visibleNotifications.map((notification) => (
                        <Notification
                            key={notification.id}
                            message={notification.message}
                            type={notification.type}
                            title={notification.title}
                            createdAt={notification.createdAt}
                            exiting={notification.exiting}
                            onActivate={notification.onClick ? () => {
                                notification.onClick();
                                dismissNotification(notification.id);
                            } : null}
                            onDismiss={() => dismissNotification(notification.id)}
                        />
                    ))}
                </div>
            )}
        </NotificationContext.Provider>
    );
};
