using System;
using System.Security.Cryptography;
using System.Text;

namespace dpapi_helper;

class Program
{
    static void Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.Write("Usage: dpapi-helper <protect|unprotect> <data>");
            Environment.Exit(1);
        }

        string mode = args[0];
        string data = args[1];

        try
        {
            if (string.Equals(mode, "protect", StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrEmpty(data))
                {
                    Console.Write(string.Empty);
                    return;
                }
                var bytes = Encoding.UTF8.GetBytes(data);
                var protectedBytes = ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser);
                Console.Write(Convert.ToBase64String(protectedBytes));
            }
            else if (string.Equals(mode, "unprotect", StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrEmpty(data))
                {
                    Console.Write(string.Empty);
                    return;
                }
                var protectedBytes = Convert.FromBase64String(data);
                var bytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
                Console.Write(Encoding.UTF8.GetString(bytes));
            }
            else
            {
                Console.Error.Write("Invalid mode. Use 'protect' or 'unprotect'.");
                Environment.Exit(1);
            }
        }
        catch (Exception ex)
        {
            Console.Error.Write(ex.Message);
            Environment.Exit(1);
        }
    }
}
