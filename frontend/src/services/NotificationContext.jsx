import React, { createContext, useState, useCallback, useContext } from 'react';

const NotificationContext = createContext({
    addNotification: (message, type) => console.warn("NotificationProvider missing! Message:", message)
});

export const useNotification = () => useContext(NotificationContext);

const Notification = ({ message, type, onDismiss }) => {
    const baseClasses = "notification-enter flex max-w-sm items-start gap-3 rounded-lg p-4 shadow-lg";
    const typeClasses = {
        success: "bg-green-100 border border-green-400 text-green-800",
        error: "bg-red-100 border border-red-400 text-red-800",
        notice: "bg-blue-50 border-2 border-[#003366] text-[#003366] font-semibold",
    };

    return (
        <section role={type === 'error' ? 'alert' : 'status'} aria-live={type === 'error' ? 'assertive' : 'polite'} className={`${baseClasses} ${typeClasses[type] || typeClasses.success}`}>
            <span className="min-w-0 flex-1">{message}</span>
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
        setNotifications((prev) => [...prev, { id, message, type }].slice(-4));
        setTimeout(() => {
            setNotifications((prev) => prev.filter((notification) => notification.id !== id));
        }, type === 'notice' ? 10000 : 5000);
    }, []);

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
                            onDismiss={() => dismissNotification(notification.id)}
                        />
                    ))}
                </div>
            )}
        </NotificationContext.Provider>
    );
};
